import { randomUUID } from 'node:crypto';
import { getPrismaClient } from '../database/client';
import { logger } from '../../utils/logger';
import { user_mandalas, Prisma } from '@prisma/client';
import { nanoid } from 'nanoid';
import { DEFAULT_TIER, getMandalaLimit, type Tier } from '@/config/quota';
import {
  EXPLORE_PAGE_LIMIT,
  EXPLORE_DEFAULT_PAGE_SIZE,
  type ExploreSource,
  type ExploreSort,
} from '@/config/explore';

/**
 * Interactive transaction budget for mandala write paths.
 *
 * History:
 *   - CP358 (2026-04-16): 5_000 → 30_000ms. 30s chosen vs observed
 *     cold-connection worst case 30,731ms.
 *   - 2026-04-18 incident A: prod P2028 at 32,323ms. Not deployed
 *     (stashed as `cp389.1-unsent`).
 *   - 2026-04-18 incident B (req-1f): prod P2028 at 31,339ms, single
 *     retry succeeded with `create_mandala` stage = 23,902ms. The 30s
 *     budget is a rolling dice — transactions routinely consume 22-25s
 *     and occasionally exceed. Raising to 60_000ms to align with the FE
 *     client timeout. **This is a stopgap.** The real issue is that the
 *     transaction itself averages 23s for ~3 RTTs, which is 50-100×
 *     above the expected ~300ms. Instrumentation added below (per-query
 *     timing in `createMandala`) is the next step to identify which
 *     query stalls. If future deploys hit the 60s ceiling, escalate to
 *     endpoint split (`docs/design/wizard-skeleton-bg-fill.md`).
 */
export const TX_TIMEOUT_MS = 60_000;

interface MandalaLevelData {
  levelKey: string;
  centerGoal: string;
  centerLabel?: string;
  subjects: string[];
  subjectLabels?: string[];
  position: number;
  depth: number;
  color?: string | null;
  parentLevelKey?: string | null;
}

export interface MandalaWithLevels {
  id: string;
  userId: string;
  title: string;
  isDefault: boolean;
  isPublic: boolean;
  shareSlug: string | null;
  position: number;
  createdAt: Date;
  updatedAt: Date;
  levels: {
    id: string;
    levelKey: string;
    centerGoal: string;
    centerLabel: string | null;
    subjects: string[];
    subjectLabels: string[];
    position: number;
    depth: number;
    color: string | null;
    parentLevelId: string | null;
  }[];
}

export interface ExploreMandala {
  id: string;
  title: string;
  shareSlug: string | null;
  domain: string | null;
  isTemplate: boolean;
  likeCount: number;
  cloneCount: number;
  createdAt: Date;
  updatedAt: Date;
  author: { displayName: string; avatarInitial: string } | null;
  rootLevel: {
    centerGoal: string;
    centerLabel: string | null;
    subjects: string[];
    subjectLabels: string[];
  } | null;
}

export interface ExploreFilters {
  q?: string;
  domain?: string;
  language?: string;
  source?: ExploreSource;
  sort?: ExploreSort;
  page?: number;
  limit?: number;
}

interface ListMandalasResult {
  mandalas: MandalaWithLevels[];
  total: number;
  page: number;
  limit: number;
}

interface UserQuota {
  tier: string;
  limit: number | null;
  used: number;
  remaining: number | null;
}

let instance: MandalaManager | null = null;

export function getMandalaManager(): MandalaManager {
  if (!instance) {
    instance = new MandalaManager();
  }
  return instance;
}

export class MandalaManager {
  private get prisma() {
    return getPrismaClient();
  }

  /**
   * Maps a raw user_mandalas Prisma record (with included levels) to MandalaWithLevels.
   */
  private mapMandala(
    mandala: user_mandalas & {
      levels: {
        id: string;
        level_key: string;
        center_goal: string;
        center_label?: string | null;
        subjects: string[];
        subject_labels?: string[];
        position: number;
        depth: number;
        color: string | null;
        parent_level_id: string | null;
      }[];
    }
  ): MandalaWithLevels {
    return {
      id: mandala.id,
      userId: mandala.user_id,
      title: mandala.title,
      isDefault: mandala.is_default,
      isPublic: mandala.is_public,
      shareSlug: mandala.share_slug,
      position: mandala.position,
      createdAt: mandala.created_at,
      updatedAt: mandala.updated_at,
      levels: mandala.levels.map((l) => ({
        id: l.id,
        levelKey: l.level_key,
        centerGoal: l.center_goal,
        centerLabel: l.center_label ?? null,
        subjects: l.subjects,
        subjectLabels: l.subject_labels ?? [],
        position: l.position,
        depth: l.depth,
        color: l.color,
        parentLevelId: l.parent_level_id,
      })),
    };
  }

  /**
   * Creates levels for a mandala inside a transaction using the two-pass pattern
   * (root level first, then child levels). Returns the levelIdMap.
   */
  private async createLevels(
    tx: Omit<
      ReturnType<typeof getPrismaClient>,
      '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
    >,
    mandalaId: string,
    levels: MandalaLevelData[]
  ): Promise<Map<string, string>> {
    // CP358 hotfix — was the architectural cause of every "Failed to create
    // mandala" P2028 timeout in this session. Previous implementation issued
    // 1 + N sequential `tx.create()` calls inside the interactive transaction
    // (1 root + 8 children = 9 round-trips). Each round-trip pays pgbouncer
    // transaction-pool overhead + Supabase Cloud RTT (~3s in prod), so the
    // 9 inserts alone exceeded the 5s default Prisma timeout, and even the
    // 30s bandaid wasn't enough on cold connections (30,731ms observed).
    //
    // Fix: pre-generate UUIDs in JS so parent → child FK refs (parent_level_id)
    // can be wired up *without* a round-trip per row. Then one `createMany()`
    // batches all 9 rows into a single SQL statement = 1 round-trip total.
    // The interactive transaction wrapping createMandala / updateMandalaLevels
    // now does ~3 round-trips end-to-end instead of 11+, so the 30s timeout
    // is comfortable headroom rather than a failing budget.
    const levelIdMap = new Map<string, string>();

    // Pass 1: assign a stable UUID to every level so we can resolve
    // parent_level_id refs in JS without writing first.
    const idsByKey = new Map<string, string>();
    for (const level of levels) {
      idsByKey.set(level.levelKey, randomUUID());
    }

    // Pass 2: build the createMany payload with pre-resolved FKs.
    const data: Prisma.user_mandala_levelsCreateManyInput[] = levels.map((level) => ({
      id: idsByKey.get(level.levelKey)!,
      mandala_id: mandalaId,
      parent_level_id: level.parentLevelKey ? (idsByKey.get(level.parentLevelKey) ?? null) : null,
      level_key: level.levelKey,
      center_goal: level.centerGoal,
      center_label: level.centerLabel ?? null,
      subjects: level.subjects,
      subject_labels: level.subjectLabels ?? [],
      position: level.position,
      depth: level.depth,
      color: level.color ?? null,
    }));

    await tx.user_mandala_levels.createMany({ data });

    for (const [key, id] of idsByKey) {
      levelIdMap.set(key, id);
    }
    return levelIdMap;
  }

  /**
   * Verifies that a mandala exists and is owned by userId.
   * Throws 'Mandala not found' if not found or ownership mismatch.
   */
  private async verifyOwnership(
    userId: string,
    mandalaId: string,
    tx?: Omit<
      ReturnType<typeof getPrismaClient>,
      '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
    >
  ): Promise<user_mandalas> {
    const client = tx ?? this.prisma;
    const mandala = await client.user_mandalas.findFirst({
      where: { id: mandalaId, user_id: userId },
    });

    if (!mandala) {
      throw new Error('Mandala not found');
    }

    return mandala;
  }

  /**
   * Title uniqueness check — DISABLED (2026-04-16).
   *
   * Users legitimately want to iterate on the same goal (e.g. create a
   * new "한 달안에 토플 100점 달성" after an earlier attempt stalled)
   * without being blocked by an earlier run of the wizard. There is no
   * DB-level UNIQUE constraint — the old logic was a BE-only guard that
   * accidentally prevented re-attempts. Kept as a no-op so callers
   * (createMandala) keep compiling; if duplicate-detection is needed
   * again it can live as an opt-in heuristic rather than a hard block.
   *
   * The `DUPLICATE_TITLE` error code paths in the route handlers are
   * left intact — they're now unreachable from this flow but still
   * protect future callers that might re-enable the check locally.
   */
  async checkDuplicateTitle(_userId: string, _title: string): Promise<void> {
    // Intentionally empty — duplicate titles are allowed.
  }

  /**
   * Gets the default mandala for a user. Backward-compatible.
   */
  async getMandala(userId: string): Promise<MandalaWithLevels | null> {
    const mandala = await this.prisma.user_mandalas.findFirst({
      where: { user_id: userId, is_default: true },
      include: {
        levels: {
          orderBy: [{ depth: 'asc' }, { position: 'asc' }],
        },
      },
    });

    if (!mandala) return null;

    return this.mapMandala(mandala);
  }

  /**
   * Gets a specific mandala by ID, verifying ownership.
   * Returns null if not found or not owned by the user.
   */
  async getMandalaById(userId: string, mandalaId: string): Promise<MandalaWithLevels | null> {
    const mandala = await this.prisma.user_mandalas.findFirst({
      where: { id: mandalaId, user_id: userId },
      include: {
        levels: {
          orderBy: [{ depth: 'asc' }, { position: 'asc' }],
        },
      },
    });

    if (!mandala) return null;

    return this.mapMandala(mandala);
  }

  /**
   * Lists all mandalas for a user with pagination.
   * Ordered by: is_default DESC, position ASC, created_at DESC.
   */
  async listMandalas(
    userId: string,
    options?: { page?: number; limit?: number }
  ): Promise<ListMandalasResult> {
    const page = options?.page ?? 1;
    const hasLimit = options?.limit != null;
    const limit = options?.limit ?? 0;
    const skip = hasLimit ? (page - 1) * limit : 0;

    const [mandalas, total] = await Promise.all([
      this.prisma.user_mandalas.findMany({
        where: { user_id: userId },
        include: {
          levels: {
            orderBy: [{ depth: 'asc' }, { position: 'asc' }],
          },
        },
        orderBy: [{ is_default: 'desc' }, { created_at: 'desc' }],
        ...(hasLimit ? { skip, take: limit } : {}),
      }),
      this.prisma.user_mandalas.count({
        where: { user_id: userId },
      }),
    ]);

    return {
      mandalas: mandalas.map((m) => this.mapMandala(m)),
      total,
      page: hasLimit ? page : 1,
      limit: hasLimit ? limit : total,
    };
  }

  /**
   * CP420 γ (Path B step 1): Persist createMandala per-step timings
   * to `mandala_create_timings` table. Fire-and-forget after tx commit
   * (ok path) or inside catch (error path) — does NOT affect the M7
   * measurement being recorded.
   *
   * Rationale: console.info '[mandala-create-timing]' logs are only
   * retained in docker stdout (~48h). DB persistence enables CP421+
   * Lever A++ DROP pre/post M7 comparison (n≥3) via SELECT.
   *
   * Failure is logged via logger.error (non-blocking, never re-thrown)
   * per work-efficiency.md line 298 convention.
   */
  private persistCreateTiming(params: {
    mandalaId: string | null;
    userId: string;
    outcome: 'ok' | 'error';
    timings: Record<string, number>;
    error?: string;
  }): void {
    this.prisma.mandala_create_timings
      .create({
        data: {
          mandala_id: params.mandalaId,
          user_id: params.userId,
          outcome: params.outcome,
          timings: params.timings as Prisma.InputJsonValue,
          error: params.error ?? null,
        },
      })
      .catch((err) => {
        logger.error('mandala_create_timings persist failed (non-blocking)', {
          err,
          mandalaId: params.mandalaId,
          userId: params.userId,
          outcome: params.outcome,
        });
      });
  }

  /**
   * Creates a new mandala with tier-based quota enforcement.
   * The quota check and insert are atomic inside a transaction.
   */
  async createMandala(
    userId: string,
    title: string,
    levels: MandalaLevelData[],
    options: { promoteToDefault?: boolean } = {}
  ): Promise<MandalaWithLevels> {
    // Per-step wall-clock timing so P2028 incidents have a data-driven
    // root cause trail. Emitted via console.info at function exit so the
    // pino/Fastify logger that writes to docker stdout captures the row.
    // Kept outside the winston logger on purpose — winston writes to file
    // in this codebase and docker logs were blank when we needed them.
    const tFnStart = Date.now();
    const timings: Record<string, number> = {};

    // Step 0: Duplicate title check (CP362 #386)
    const tDup = Date.now();
    await this.checkDuplicateTitle(userId, title);
    timings['dup_check'] = Date.now() - tDup;

    // Step 1: Read queries outside transaction (parallel)
    const tParallel = Date.now();
    const [subscription, adminCheck, count, maxPositionResult] = await Promise.all([
      this.prisma.user_subscriptions.findUnique({
        where: { user_id: userId },
        select: { tier: true, mandala_limit: true },
      }),
      this.prisma.$queryRaw<Array<{ is_super_admin: boolean | null }>>`
        SELECT is_super_admin FROM auth.users WHERE id = ${userId}::uuid
      `,
      this.prisma.user_mandalas.count({
        where: { user_id: userId },
      }),
      this.prisma.user_mandalas.aggregate({
        where: { user_id: userId },
        _max: { position: true },
      }),
    ]);
    timings['parallel_reads'] = Date.now() - tParallel;

    // Step 2: Quota validation (in-memory)
    const isSuperAdmin = adminCheck[0]?.is_super_admin === true;
    const tier = isSuperAdmin ? ('admin' as Tier) : ((subscription?.tier ?? DEFAULT_TIER) as Tier);
    const tierLimit = getMandalaLimit(tier);
    const limit =
      isSuperAdmin || tierLimit === Infinity ? null : (subscription?.mandala_limit ?? tierLimit);

    if (limit !== null && count >= limit) {
      const err = new Error('Mandala quota exceeded') as Error & {
        quota: number;
        current: number;
      };
      err.quota = limit;
      err.current = count;
      throw err;
    }

    // CP416 Phase C (2026-04-22): `promoteToDefault` lets the wizard
    // path atomically demote the existing default and promote the new
    // mandala inside the same transaction, instead of relying on a
    // fire-and-forget `updateMandala({isDefault:true}).catch(swallow)`
    // after the insert. The old pattern raced with the response and
    // silently dropped on failure, leaving the new mandala
    // `is_default=false` and the user looking at the previous default
    // in the dashboard.
    const isDefault = count === 0 || options.promoteToDefault === true;
    const position = (maxPositionResult._max.position ?? -1) + 1;

    // Step 3: Transaction for writes only. Budget lives in TX_TIMEOUT_MS
    // at the top of this file — see history comment there.
    try {
      const tTx = Date.now();
      const result = await this.prisma.$transaction(
        async (tx) => {
          // Phase C: if the caller asked for promoteToDefault AND there
          // is already at least one existing mandala, demote the others
          // in the same tx so at most one row ever has is_default=true.
          if (options.promoteToDefault === true && count > 0) {
            await tx.user_mandalas.updateMany({
              where: { user_id: userId, is_default: true },
              data: { is_default: false },
            });
          }
          const tMandalaCreate = Date.now();
          const mandala = await tx.user_mandalas.create({
            data: {
              user_id: userId,
              title,
              is_default: isDefault,
              position,
            },
          });
          timings['tx_mandala_create'] = Date.now() - tMandalaCreate;

          const tLevels = Date.now();
          await this.createLevels(tx as any, mandala.id, levels);
          timings['tx_levels_createMany'] = Date.now() - tLevels;

          logger.info(`Mandala created: userId=${userId}, mandalaId=${mandala.id}, tier=${tier}`);

          const tFind = Date.now();
          const result = await tx.user_mandalas.findUnique({
            where: { id: mandala.id },
            include: {
              levels: {
                orderBy: [{ depth: 'asc' }, { position: 'asc' }],
              },
            },
          });
          timings['tx_find_unique'] = Date.now() - tFind;

          if (!result) {
            throw new Error('Failed to create mandala');
          }

          return this.mapMandala(result);
        },
        {
          maxWait: 5_000,
          timeout: TX_TIMEOUT_MS,
        }
      );
      timings['tx_total'] = Date.now() - tTx;
      timings['total'] = Date.now() - tFnStart;
      console.info(
        '[mandala-create-timing]',
        JSON.stringify({ userId, title, outcome: 'ok', ...timings })
      );
      this.persistCreateTiming({
        mandalaId: result.id,
        userId,
        outcome: 'ok',
        timings,
      });
      return result;
    } catch (err) {
      timings['total'] = Date.now() - tFnStart;
      const errMsg = err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500);
      console.info(
        '[mandala-create-timing]',
        JSON.stringify({
          userId,
          title,
          outcome: 'error',
          error: errMsg.slice(0, 200),
          ...timings,
        })
      );
      this.persistCreateTiming({
        mandalaId: null,
        userId,
        outcome: 'error',
        timings,
        error: errMsg,
      });
      throw err;
    }
  }

  /**
   * Updates mandala metadata (title, isDefault, position).
   * If isDefault=true, demotes all other user mandalas first.
   */
  async updateMandala(
    userId: string,
    mandalaId: string,
    data: { title?: string; isDefault?: boolean; position?: number }
  ): Promise<MandalaWithLevels> {
    // CP358 hotfix — verifyOwnership is a pure read (no atomicity needed
    // with the writes), so move it outside the transaction. That removes
    // 1 round-trip from the transaction budget. The remaining writes
    // (optional updateMany + update + final findUnique) still benefit from
    // the same 30s budget as createMandala — pgbouncer round-trip variance
    // is what overran the default 5000ms timeout (6,143ms observed).
    await this.verifyOwnership(userId, mandalaId);

    return await this.prisma.$transaction(
      async (tx) => {
        if (data.isDefault === true) {
          // Demote all other mandalas for this user
          await tx.user_mandalas.updateMany({
            where: { user_id: userId, id: { not: mandalaId } },
            data: { is_default: false },
          });
        }

        await tx.user_mandalas.update({
          where: { id: mandalaId, user_id: userId },
          data: {
            ...(data.title !== undefined && { title: data.title }),
            ...(data.isDefault !== undefined && { is_default: data.isDefault }),
            ...(data.position !== undefined && { position: data.position }),
            updated_at: new Date(),
          },
        });

        logger.info(`Mandala updated: userId=${userId}, mandalaId=${mandalaId}`);

        const result = await tx.user_mandalas.findUnique({
          where: { id: mandalaId, user_id: userId },
          include: {
            levels: {
              orderBy: [{ depth: 'asc' }, { position: 'asc' }],
            },
          },
        });

        if (!result) {
          throw new Error('Failed to update mandala');
        }

        return this.mapMandala(result);
      },
      {
        maxWait: 5_000,
        timeout: TX_TIMEOUT_MS,
      }
    );
  }

  /**
   * Replaces all levels of a specific mandala.
   * Verifies ownership, deletes existing levels, recreates with two-pass pattern.
   */
  async updateMandalaLevels(
    userId: string,
    mandalaId: string,
    levels: MandalaLevelData[]
  ): Promise<MandalaWithLevels> {
    // CP358: same large-transaction timeout fix as createMandala. delete +
    // recreate of 1 root + 8 child + ~64 actions through pgbouncer can
    // exceed Prisma's default 5000ms.
    return await this.prisma.$transaction(
      async (tx) => {
        await this.verifyOwnership(userId, mandalaId, tx as any);

        // Delete and recreate levels
        await tx.user_mandala_levels.deleteMany({
          where: { mandala_id: mandalaId },
        });

        await this.createLevels(tx as any, mandalaId, levels);

        // Touch updated_at on parent mandala
        await tx.user_mandalas.update({
          where: { id: mandalaId, user_id: userId },
          data: { updated_at: new Date() },
        });

        logger.info(`Mandala levels updated: userId=${userId}, mandalaId=${mandalaId}`);

        // Lever A (CP416) — ontology edges are synced fire-and-forget
        // post-commit. See `sync-edges.ts` + `ontology-trigger-defer.md`.
        // Scheduled after the tx resolves so failures don't roll back
        // the primary update.
        void this.scheduleOntologyEdgeSync(mandalaId);

        const result = await tx.user_mandalas.findUnique({
          where: { id: mandalaId, user_id: userId },
          include: {
            levels: {
              orderBy: [{ depth: 'asc' }, { position: 'asc' }],
            },
          },
        });

        if (!result) {
          throw new Error('Failed to update mandala levels');
        }

        return this.mapMandala(result);
      },
      { maxWait: 5_000, timeout: TX_TIMEOUT_MS }
    );
  }

  /**
   * Deletes a mandala. If it was the default and other mandalas exist,
   * promotes the next one (lowest position) to default.
   */
  async deleteMandala(userId: string, mandalaId: string): Promise<void> {
    // Step 1: Verify ownership outside transaction (read-only)
    const mandala = await this.verifyOwnership(userId, mandalaId);

    // Step 2: Move orphaned cards outside transaction (non-fatal pre-step)
    // If this fails, FK onDelete: SetNull will set mandala_id to NULL anyway
    try {
      const defaultMandala = mandala.is_default
        ? null
        : await this.prisma.user_mandalas.findFirst({
            where: { user_id: userId, is_default: true },
          });

      const next = mandala.is_default
        ? await this.prisma.user_mandalas.findFirst({
            where: { user_id: userId, id: { not: mandalaId } },
            orderBy: [{ position: 'asc' }, { created_at: 'asc' }],
          })
        : null;

      const targetMandalaId = mandala.is_default
        ? (next?.id ?? null)
        : (defaultMandala?.id ?? null);

      await Promise.all([
        this.prisma.userVideoState.updateMany({
          where: { user_id: userId, mandala_id: mandalaId },
          data: { mandala_id: targetMandalaId, cell_index: -1, level_id: 'scratchpad' },
        }),
        this.prisma.user_local_cards.updateMany({
          where: { user_id: userId, mandala_id: mandalaId },
          data: { mandala_id: targetMandalaId, cell_index: -1, level_id: 'scratchpad' },
        }),
      ]);
    } catch (cardErr: any) {
      logger.warn('Move orphaned cards skipped — FK onDelete:SetNull will handle cleanup', {
        error: cardErr?.message,
        userId,
        mandalaId,
      });
    }

    // Step 3: Delete mandala in a clean transaction
    // CP362: same 30s timeout as createMandala/updateMandalaLevels.
    // Cascade across 9+ related tables via pgbouncer can exceed default 5s.
    await this.prisma.$transaction(
      async (tx) => {
        // Re-verify ownership inside transaction
        const current = await this.verifyOwnership(userId, mandalaId, tx as any);

        // If deleting the default mandala, promote the next candidate
        if (current.is_default) {
          const next = await tx.user_mandalas.findFirst({
            where: { user_id: userId, id: { not: mandalaId } },
            orderBy: [{ position: 'asc' }, { created_at: 'asc' }],
          });

          if (next) {
            await tx.user_mandalas.update({
              where: { id: next.id },
              data: { is_default: true },
            });
          }
        }

        // Cascade deletes levels via Prisma relation onDelete: Cascade
        await tx.user_mandalas.delete({
          where: { id: mandalaId, user_id: userId },
        });
      },
      { maxWait: 5_000, timeout: TX_TIMEOUT_MS }
    );

    logger.info(`Mandala deleted: userId=${userId}, mandalaId=${mandalaId}`);
  }

  /**
   * Returns quota information for the user.
   */
  async getUserQuota(userId: string): Promise<UserQuota> {
    const [subscription, used, adminCheck] = await Promise.all([
      this.prisma.user_subscriptions.findUnique({
        where: { user_id: userId },
        select: { tier: true, mandala_limit: true },
      }),
      this.prisma.user_mandalas.count({
        where: { user_id: userId },
      }),
      this.prisma.$queryRaw<Array<{ is_super_admin: boolean | null }>>`
        SELECT is_super_admin FROM auth.users WHERE id = ${userId}::uuid
      `,
    ]);

    const isSuperAdmin = adminCheck[0]?.is_super_admin === true;
    const tier = isSuperAdmin ? ('admin' as Tier) : ((subscription?.tier ?? DEFAULT_TIER) as Tier);
    const tierLimit = getMandalaLimit(tier);
    const isUnlimited = isSuperAdmin || tierLimit === Infinity;
    const limit = isUnlimited ? null : (subscription?.mandala_limit ?? tierLimit);

    return {
      tier,
      limit,
      used,
      remaining: limit === null ? null : Math.max(0, limit - used),
    };
  }

  /**
   * Links all unlinked cards (UserVideoState + user_local_cards) to the given mandala.
   * Only updates cards where mandala_id IS NULL for the given user.
   * Returns the number of cards linked.
   */
  async linkCardsToMandala(
    userId: string,
    mandalaId: string
  ): Promise<{ videoStates: number; localCards: number }> {
    const [videoResult, cardResult] = await Promise.all([
      this.prisma.userVideoState.updateMany({
        where: { user_id: userId, mandala_id: null },
        data: { mandala_id: mandalaId },
      }),
      this.prisma.user_local_cards.updateMany({
        where: { user_id: userId, mandala_id: null },
        data: { mandala_id: mandalaId },
      }),
    ]);

    const linked = { videoStates: videoResult.count, localCards: cardResult.count };
    if (linked.videoStates > 0 || linked.localCards > 0) {
      logger.info(
        `Cards linked to mandala: userId=${userId}, mandalaId=${mandalaId}, ` +
          `videoStates=${linked.videoStates}, localCards=${linked.localCards}`
      );
    }

    return linked;
  }

  /**
   * Upserts the default mandala for a user. Backward-compatible.
   */
  async upsertMandala(
    userId: string,
    title: string,
    levels: MandalaLevelData[]
  ): Promise<MandalaWithLevels> {
    // CP358 hotfix — was a third copy of the sequential-create-loop bug
    // that killed createMandala. Now delegates to the shared
    // `createLevels` helper (single createMany, 1 round-trip) and opts into
    // the 30s transaction budget like createMandala / updateMandalaLevels.
    return await this.prisma.$transaction(
      async (tx) => {
        // Upsert mandala
        let mandala = await tx.user_mandalas.findFirst({
          where: { user_id: userId, is_default: true },
        });

        if (mandala) {
          mandala = await tx.user_mandalas.update({
            where: { id: mandala.id },
            data: { title, updated_at: new Date() },
          });
        } else {
          mandala = await tx.user_mandalas.create({
            data: {
              user_id: userId,
              title,
              is_default: true,
              position: 0,
            },
          });
        }

        // Delete existing levels and recreate via the shared batched helper
        await tx.user_mandala_levels.deleteMany({
          where: { mandala_id: mandala.id },
        });
        await this.createLevels(tx as any, mandala.id, levels);

        // Fetch the complete result using tx (inside transaction)
        const fullMandala = await tx.user_mandalas.findFirst({
          where: { id: mandala.id, user_id: userId },
          include: {
            levels: {
              orderBy: [{ depth: 'asc' }, { position: 'asc' }],
            },
          },
        });

        if (!fullMandala) {
          throw new Error('Failed to create mandala');
        }

        logger.info(`Mandala upserted: userId=${userId}, mandalaId=${mandala.id}`);
        return this.mapMandala(fullMandala);
      },
      {
        maxWait: 5_000,
        timeout: TX_TIMEOUT_MS,
      }
    );
  }

  /**
   * Toggles the public visibility of a mandala.
   * When making public, generates a unique share_slug via nanoid.
   * When making private, clears the share_slug.
   */
  async togglePublic(
    userId: string,
    mandalaId: string,
    isPublic: boolean
  ): Promise<MandalaWithLevels> {
    return await this.prisma.$transaction(async (tx) => {
      await this.verifyOwnership(userId, mandalaId, tx as any);

      const shareSlug = isPublic ? nanoid(12) : null;

      await tx.user_mandalas.update({
        where: { id: mandalaId },
        data: {
          is_public: isPublic,
          share_slug: shareSlug,
          updated_at: new Date(),
        },
      });

      // If making private, remove all subscriptions
      if (!isPublic) {
        await tx.mandala_subscriptions.deleteMany({
          where: { mandala_id: mandalaId },
        });
      }

      logger.info(
        `Mandala visibility changed: userId=${userId}, mandalaId=${mandalaId}, isPublic=${isPublic}`
      );

      const result = await tx.user_mandalas.findUnique({
        where: { id: mandalaId },
        include: {
          levels: {
            orderBy: [{ depth: 'asc' }, { position: 'asc' }],
          },
        },
      });

      if (!result) {
        throw new Error('Failed to update mandala');
      }

      return this.mapMandala(result);
    });
  }

  /**
   * Gets a public mandala by its share slug. No authentication required.
   * Returns null if not found or not public.
   */
  async getPublicMandala(shareSlug: string): Promise<MandalaWithLevels | null> {
    const mandala = await this.prisma.user_mandalas.findFirst({
      where: { share_slug: shareSlug, is_public: true },
      include: {
        levels: {
          orderBy: [{ depth: 'asc' }, { position: 'asc' }],
        },
      },
    });

    if (!mandala) return null;

    return this.mapMandala(mandala);
  }

  /**
   * Lists public mandalas with filtering, sorting, and search for the explore page.
   */
  async listExploreMandalas(
    filters: ExploreFilters = {}
  ): Promise<{ mandalas: ExploreMandala[]; total: number; page: number; limit: number }> {
    const page = filters.page ?? 1;
    const limit = Math.min(filters.limit ?? EXPLORE_DEFAULT_PAGE_SIZE, EXPLORE_PAGE_LIMIT);
    const skip = (page - 1) * limit;

    // Build WHERE clause
    const conditions: Prisma.user_mandalasWhereInput[] = [];

    if (filters.source === 'template') {
      conditions.push({ is_template: true });
    } else if (filters.source === 'community') {
      conditions.push({ is_public: true, is_template: false });
    } else {
      conditions.push({ OR: [{ is_public: true }, { is_template: true }] });
    }

    if (filters.language) {
      conditions.push({ language: filters.language });
    }

    if (filters.domain) {
      conditions.push({ domain: filters.domain });
    }

    if (filters.q) {
      const search = filters.q;
      conditions.push({
        OR: [
          { title: { contains: search, mode: 'insensitive' } },
          {
            levels: {
              some: {
                depth: 0,
                center_goal: { contains: search, mode: 'insensitive' },
              },
            },
          },
        ],
      });
    }

    const where: Prisma.user_mandalasWhereInput = { AND: conditions };

    // Build ORDER BY
    type SortKey = 'popular' | 'recent' | 'cloned';
    const sortMap: Record<SortKey, Prisma.user_mandalasOrderByWithRelationInput[]> = {
      popular: [{ like_count: 'desc' }, { created_at: 'desc' }],
      recent: [{ created_at: 'desc' }],
      cloned: [{ clone_count: 'desc' }, { created_at: 'desc' }],
    };
    const sortKey: SortKey = (filters.sort as SortKey) ?? 'popular';
    const orderBy = sortMap[sortKey];

    const [mandalas, total] = await Promise.all([
      this.prisma.user_mandalas.findMany({
        where,
        include: {
          levels: {
            where: { depth: 0 },
            orderBy: [{ position: 'asc' }],
            take: 1,
          },
          users: {
            select: {
              id: true,
              raw_user_meta_data: true,
            },
          },
        },
        orderBy,
        skip,
        take: limit,
      }),
      this.prisma.user_mandalas.count({ where }),
    ]);

    return {
      mandalas: mandalas.map((m) => this.mapExploreMandala(m)),
      total,
      page,
      limit,
    };
  }

  /**
   * Maps a raw mandala record to ExploreMandala shape for the explore API.
   */
  private mapExploreMandala(
    mandala: user_mandalas & {
      levels: {
        center_goal: string;
        center_label?: string | null;
        subjects: string[];
        subject_labels?: string[];
      }[];
      users: {
        id: string;
        raw_user_meta_data: unknown;
      };
    }
  ): ExploreMandala {
    const rootLevel = mandala.levels[0] ?? null;
    const meta = (mandala.users.raw_user_meta_data ?? {}) as Record<string, string>;
    const displayName = meta['full_name'] ?? meta['name'] ?? 'User';
    const avatarInitial = displayName.charAt(0).toUpperCase();

    return {
      id: mandala.id,
      title: mandala.title,
      shareSlug: mandala.share_slug,
      domain: mandala.domain,
      isTemplate: mandala.is_template,
      likeCount: mandala.like_count,
      cloneCount: mandala.clone_count,
      createdAt: mandala.created_at,
      updatedAt: mandala.updated_at,
      author: mandala.is_template ? null : { displayName, avatarInitial },
      rootLevel: rootLevel
        ? {
            centerGoal: rootLevel.center_goal,
            centerLabel: rootLevel.center_label ?? null,
            subjects: rootLevel.subjects,
            subjectLabels: rootLevel.subject_labels ?? [],
          }
        : null,
    };
  }

  /**
   * Toggles a like on a public mandala. Returns the new liked state and count.
   */
  async toggleLike(
    userId: string,
    mandalaId: string
  ): Promise<{ liked: boolean; likeCount: number }> {
    const existing = await this.prisma.mandala_likes.findUnique({
      where: { user_id_mandala_id: { user_id: userId, mandala_id: mandalaId } },
    });

    if (existing) {
      await this.prisma.$transaction([
        this.prisma.mandala_likes.delete({
          where: { id: existing.id },
        }),
        this.prisma.user_mandalas.update({
          where: { id: mandalaId },
          data: { like_count: { decrement: 1 } },
        }),
      ]);
    } else {
      await this.prisma.$transaction([
        this.prisma.mandala_likes.create({
          data: { user_id: userId, mandala_id: mandalaId },
        }),
        this.prisma.user_mandalas.update({
          where: { id: mandalaId },
          data: { like_count: { increment: 1 } },
        }),
      ]);
    }

    const updated = await this.prisma.user_mandalas.findUnique({
      where: { id: mandalaId },
      select: { like_count: true },
    });

    return {
      liked: !existing,
      likeCount: updated?.like_count ?? 0,
    };
  }

  /**
   * Clones a public mandala for the target user.
   * Copies structure (levels) without cards. Increments source clone_count.
   */
  async clonePublicMandala(
    sourceMandalaId: string,
    targetUserId: string,
    options?: {
      sourceTemplateId?: string;
      focusTags?: string[];
      targetLevel?: string;
    }
  ): Promise<{ mandalaId: string; title: string }> {
    // Parallel pre-checks: source lookup + duplicate title + existing count
    const [source, existingCount] = await Promise.all([
      this.prisma.user_mandalas.findFirst({
        where: {
          id: sourceMandalaId,
          OR: [{ is_public: true }, { is_template: true }],
        },
        select: { id: true, title: true },
      }),
      this.prisma.user_mandalas.count({
        where: { user_id: targetUserId },
      }),
    ]);

    if (!source) {
      throw new Error('MANDALA_NOT_FOUND');
    }

    const baseTitle = `${source.title} (cloned)`;
    const existing = await this.prisma.user_mandalas.findFirst({
      where: { user_id: targetUserId, title: baseTitle },
      select: { id: true },
    });
    const clonedTitle = existing ? `${source.title} (cloned ${Date.now()})` : baseTitle;

    // Create mandala with all metadata in a single INSERT
    const newMandala = await this.prisma.user_mandalas.create({
      data: {
        user_id: targetUserId,
        title: clonedTitle,
        is_default: existingCount === 0,
        is_public: false,
        source_template_id: options?.sourceTemplateId ?? null,
        focus_tags: options?.focusTags ?? [],
        target_level: options?.targetLevel ?? 'standard',
      },
    });

    // Batch clone: INSERT...SELECT + UPDATE parent_level_id via CTE (2 queries instead of 18)
    const cloneResult = await this.prisma.$queryRaw<Array<{ levels_cloned: bigint }>>`
      WITH source_levels AS (
        SELECT id, level_key, center_goal, center_label, subjects, subject_labels,
               depth, color, position, parent_level_id
        FROM public.user_mandala_levels
        WHERE mandala_id = ${sourceMandalaId}::uuid
      ),
      inserted AS (
        INSERT INTO public.user_mandala_levels
          (mandala_id, level_key, center_goal, center_label, subjects, subject_labels, depth, color, position)
        SELECT ${newMandala.id}::uuid, level_key, center_goal, center_label, subjects, subject_labels,
               depth, color, position
        FROM source_levels
        RETURNING id, level_key
      ),
      id_map AS (
        SELECT i.id AS new_id, s.id AS old_id, s.parent_level_id AS old_parent_id
        FROM inserted i
        JOIN source_levels s USING (level_key)
      ),
      parent_fix AS (
        UPDATE public.user_mandala_levels t
        SET parent_level_id = p.new_id
        FROM id_map c
        JOIN id_map p ON c.old_parent_id = p.old_id
        WHERE t.id = c.new_id AND c.old_parent_id IS NOT NULL
        RETURNING t.id
      )
      SELECT (SELECT count(*) FROM inserted) AS levels_cloned
    `;

    logger.info(
      `clonePublicMandala batch: source=${sourceMandalaId} new=${newMandala.id} levels=${cloneResult[0]?.levels_cloned ?? 0}`
    );

    // Increment clone_count on source (fire-and-forget — non-critical)
    void this.prisma.user_mandalas
      .update({
        where: { id: sourceMandalaId },
        data: { clone_count: { increment: 1 } },
      })
      .catch(() => {});

    return { mandalaId: newMandala.id, title: newMandala.title };
  }

  /**
   * @deprecated Use listExploreMandalas instead
   */
  async listPublicMandalas(options?: {
    page?: number;
    limit?: number;
  }): Promise<{ mandalas: MandalaWithLevels[]; total: number; page: number; limit: number }> {
    const page = options?.page ?? 1;
    const limit = options?.limit ?? 20;
    const skip = (page - 1) * limit;

    const [mandalas, total] = await Promise.all([
      this.prisma.user_mandalas.findMany({
        where: { is_public: true },
        include: {
          levels: {
            orderBy: [{ depth: 'asc' }, { position: 'asc' }],
          },
        },
        orderBy: [{ updated_at: 'desc' }],
        skip,
        take: limit,
      }),
      this.prisma.user_mandalas.count({
        where: { is_public: true },
      }),
    ]);

    return {
      mandalas: mandalas.map((m) => this.mapMandala(m)),
      total,
      page,
      limit,
    };
  }

  /**
   * Updates a single level on the default mandala for a user. Backward-compatible.
   */
  async updateLevel(
    userId: string,
    levelKey: string,
    data: { centerGoal?: string; subjects?: string[]; color?: string | null }
  ): Promise<string> {
    const mandala = await this.prisma.user_mandalas.findFirst({
      where: { user_id: userId, is_default: true },
    });

    if (!mandala) {
      throw new Error('Mandala not found');
    }

    await this.prisma.user_mandala_levels.updateMany({
      where: { mandala_id: mandala.id, level_key: levelKey },
      data: {
        ...(data.centerGoal !== undefined && { center_goal: data.centerGoal }),
        ...(data.subjects !== undefined && { subjects: data.subjects }),
        ...(data.color !== undefined && { color: data.color }),
        updated_at: new Date(),
      },
    });

    // Lever A (CP416) — ontology edges post-commit sync (fire-and-forget).
    void this.scheduleOntologyEdgeSync(mandala.id);

    return mandala.id;
  }

  /**
   * Fire-and-forget helper that imports and calls `syncOntologyEdges`.
   * Lazily loaded so the ontology module graph is not resolved by tests
   * that don't touch it. Never throws; logs on failure. See CP416 Lever
   * A (`docs/design/ontology-trigger-defer.md`).
   */
  private scheduleOntologyEdgeSync(mandalaId: string): void {
    void (async () => {
      try {
        const { syncOntologyEdges } = await import('@/modules/ontology/sync-edges');
        const result = await syncOntologyEdges(mandalaId);
        if (!result.ok) {
          logger.warn(
            `ontology-edges sync not ok for mandala=${mandalaId}: reason=${result.reason ?? 'unknown'}`
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(`ontology-edges sync threw for mandala=${mandalaId}: ${msg}`);
      }
    })();
  }

  // ─── Subscription methods (Story #85-B) ───

  async subscribe(subscriberId: string, mandalaId: string): Promise<void> {
    const mandala = await this.prisma.user_mandalas.findUnique({
      where: { id: mandalaId },
    });

    if (!mandala || !mandala.is_public) {
      throw new Error('Mandala not found or not public');
    }

    if (mandala.user_id === subscriberId) {
      throw new Error('Cannot subscribe to own mandala');
    }

    await this.prisma.mandala_subscriptions.create({
      data: {
        subscriber_id: subscriberId,
        mandala_id: mandalaId,
      },
    });

    logger.info(`Subscription created: subscriber=${subscriberId}, mandala=${mandalaId}`);
  }

  async unsubscribe(subscriberId: string, mandalaId: string): Promise<void> {
    const result = await this.prisma.mandala_subscriptions.deleteMany({
      where: {
        subscriber_id: subscriberId,
        mandala_id: mandalaId,
      },
    });

    if (result.count === 0) {
      throw new Error('Subscription not found');
    }

    logger.info(`Subscription removed: subscriber=${subscriberId}, mandala=${mandalaId}`);
  }

  async listSubscriptions(
    subscriberId: string,
    options?: { page?: number; limit?: number }
  ): Promise<{
    subscriptions: Array<{
      id: string;
      mandalaId: string;
      title: string;
      shareSlug: string | null;
      subscribedAt: Date;
    }>;
    total: number;
    page: number;
    limit: number;
  }> {
    const page = options?.page ?? 1;
    const limit = options?.limit ?? 20;
    const skip = (page - 1) * limit;

    const [subs, total] = await Promise.all([
      this.prisma.mandala_subscriptions.findMany({
        where: { subscriber_id: subscriberId },
        include: {
          mandala: { select: { id: true, title: true, is_public: true, share_slug: true } },
        },
        orderBy: { subscribed_at: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.mandala_subscriptions.count({
        where: { subscriber_id: subscriberId },
      }),
    ]);

    return {
      subscriptions: subs
        .filter((s) => s.mandala.is_public)
        .map((s) => ({
          id: s.id,
          mandalaId: s.mandala_id,
          title: s.mandala.title,
          shareSlug: s.mandala.share_slug,
          subscribedAt: s.subscribed_at,
        })),
      total,
      page,
      limit,
    };
  }

  // ─── Activity Log methods (Story #85-B) ───

  async logActivity(
    mandalaId: string,
    userId: string,
    action: string,
    entityType: string,
    entityId?: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    await this.prisma.mandala_activity_log.create({
      data: {
        mandala_id: mandalaId,
        user_id: userId,
        action,
        entity_type: entityType,
        entity_id: entityId,
        metadata: (metadata as any) ?? undefined,
      },
    });
  }

  async getActivityLog(
    mandalaId: string,
    options?: { page?: number; limit?: number }
  ): Promise<{
    activities: Array<{
      id: string;
      action: string;
      entityType: string;
      entityId: string | null;
      metadata: unknown;
      createdAt: Date;
    }>;
    total: number;
    page: number;
    limit: number;
  }> {
    const page = options?.page ?? 1;
    const limit = options?.limit ?? 50;
    const skip = (page - 1) * limit;

    // Only allow access to public mandalas' activity
    const mandala = await this.prisma.user_mandalas.findUnique({
      where: { id: mandalaId },
      select: { is_public: true },
    });

    if (!mandala || !mandala.is_public) {
      throw new Error('Mandala not found or not public');
    }

    const [activities, total] = await Promise.all([
      this.prisma.mandala_activity_log.findMany({
        where: { mandala_id: mandalaId },
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.mandala_activity_log.count({
        where: { mandala_id: mandalaId },
      }),
    ]);

    return {
      activities: activities.map((a) => ({
        id: a.id,
        action: a.action,
        entityType: a.entity_type,
        entityId: a.entity_id,
        metadata: a.metadata,
        createdAt: a.created_at,
      })),
      total,
      page,
      limit,
    };
  }
}
