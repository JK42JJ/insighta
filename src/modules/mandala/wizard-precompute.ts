/**
 * Wizard Precompute Pipeline — runtime module (CP424.2).
 *
 * Design: docs/design/precompute-pipeline.md (CP417 draft).
 *
 * Lifecycle:
 *   1. /wizard-stream handler, after Haiku structure completes, calls
 *      `setImmediate(() => startPrecompute(...))` with real sub_goals.
 *   2. startPrecompute: INSERT row (status=pending) → UPDATE running →
 *      runDiscoverEphemeral() → UPDATE done + discover_result / failed +
 *      error_message.
 *   3. /create-with-data handler, after mandala save tx, calls
 *      `consumePrecompute(mandalaId, sessionId)`:
 *        - SELECT row WHERE session_id + status=done + expires_at > NOW()
 *          + goal matches
 *        - INSERT recommendation_cache rows with new mandala_id
 *        - cardPublisher.notify per slot → SSE card_added backlog
 *        - UPDATE status=consumed + consumed_mandala_id + consumed_at
 *        - Miss → returns { consumed: false, reason } so caller falls back
 *          to existing triggerMandalaPostCreationAsync.
 *
 * Feature flag: WIZARD_PRECOMPUTE_ENABLED (compose env, default false).
 * Rollback: 1-line env flip. No code revert.
 */

import { Prisma } from '@prisma/client';
import { getPrismaClient } from '@/modules/database/client';
import { logger } from '@/utils/logger';
import { loadWizardPrecomputeConfig } from '@/config/wizard-precompute';
import {
  runDiscoverEphemeral,
  type EphemeralDiscoverResult,
} from '@/skills/plugins/video-discover/v3/executor';
import { notifyCardAdded, type CardPayload } from '@/modules/recommendations/publisher';
import { MS_PER_DAY } from '@/utils/time-constants';
import { randomUUID } from 'crypto';

const log = logger.child({ module: 'wizard-precompute' });

const TTL_DAYS = 7; // recommendation_cache TTL when we upsert at consume-time.
const RECOMMENDATION_STATUS_PENDING = 'pending';
const WEIGHT_VERSION = 3;

// ---------------------------------------------------------------------------
// startPrecompute — /wizard-stream fire-and-forget entry
// ---------------------------------------------------------------------------

export interface StartPrecomputeInput {
  sessionId: string;
  userId: string;
  goal: string;
  language: 'ko' | 'en';
  focusTags: string[];
  targetLevel?: string;
  subGoals: string[]; // length 8 — from Haiku structure response
}

/**
 * Fire-and-forget precompute launcher. Never throws — all failures are
 * persisted to the precompute row's status=failed + error_message.
 *
 * Honors WIZARD_PRECOMPUTE_ENABLED flag at call site; if disabled, returns
 * immediately. Keep the flag check here so callers can unconditionally
 * invoke without worrying about state.
 */
export async function startPrecompute(input: StartPrecomputeInput): Promise<void> {
  const cfg = loadWizardPrecomputeConfig();
  if (!cfg.enabled) return;

  const db = getPrismaClient();
  const t0 = Date.now();

  // Step 1: INSERT row (status=pending). Idempotent via session_id PK —
  // duplicate startPrecompute calls for the same session are no-ops. We
  // intentionally do NOT update an existing row here, because concurrent
  // callers should cooperate on the earlier row's lifecycle.
  try {
    await db.mandala_wizard_precompute.create({
      data: {
        session_id: input.sessionId,
        user_id: input.userId,
        goal: input.goal,
        language: input.language,
        focus_tags: input.focusTags,
        target_level: input.targetLevel ?? null,
        status: 'pending',
      },
    });
  } catch (err) {
    // Likely PK duplicate — another in-flight call owns this session.
    // Honest log and return; never crash the wizard SSE stream.
    log.info(
      `precompute row already exists for session=${input.sessionId} (dup startPrecompute); skipping`,
      {
        error: err instanceof Error ? err.message : String(err),
      }
    );
    return;
  }

  // Step 2: UPDATE status=running (separate tx to make running visible in
  // admin dashboards while discover is in flight).
  await db.mandala_wizard_precompute.update({
    where: { session_id: input.sessionId },
    data: { status: 'running' },
  });

  log.info(`precompute running: session=${input.sessionId} goal="${input.goal.slice(0, 40)}"`, {
    sessionId: input.sessionId,
    userId: input.userId,
  });

  // Step 3: runDiscoverEphemeral → persist result
  try {
    const result = await runDiscoverEphemeral({
      centerGoal: input.goal,
      subGoals: input.subGoals,
      language: input.language,
      focusTags: input.focusTags,
      targetLevel: input.targetLevel ?? 'standard',
      env: process.env,
    });

    await db.mandala_wizard_precompute.update({
      where: { session_id: input.sessionId },
      data: {
        status: 'done',
        discover_result: result as unknown as Prisma.InputJsonValue,
      },
    });

    log.info(
      `precompute done: session=${input.sessionId} slots=${result.slots.length} ` +
        `queries=${result.queriesUsed} duration_ms=${Date.now() - t0}`,
      {
        sessionId: input.sessionId,
        slotsCount: result.slots.length,
        queriesUsed: result.queriesUsed,
      }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(
      `precompute failed: session=${input.sessionId} error=${msg.slice(0, 200)} duration_ms=${Date.now() - t0}`,
      {
        sessionId: input.sessionId,
        error: msg,
      }
    );
    try {
      await db.mandala_wizard_precompute.update({
        where: { session_id: input.sessionId },
        data: {
          status: 'failed',
          error_message: msg.slice(0, 2000),
        },
      });
    } catch (updateErr) {
      log.error(
        `precompute failed-status update also threw for session=${input.sessionId}: ${
          updateErr instanceof Error ? updateErr.message : String(updateErr)
        }`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// consumePrecompute — /create-with-data consume entry
// ---------------------------------------------------------------------------

export interface ConsumePrecomputeInput {
  sessionId: string;
  userId: string;
  mandalaId: string;
  /** Expected goal (from save payload). If mismatch → treat as miss. */
  centerGoal: string;
}

export interface ConsumePrecomputeResult {
  consumed: boolean;
  reason?:
    | 'disabled'
    | 'no-session-id'
    | 'not-found'
    | 'wrong-user'
    | 'not-done'
    | 'expired'
    | 'goal-mismatch'
    | 'empty-slots';
  cardsInserted?: number;
  slotsCount?: number;
}

/**
 * Consume a precompute row at mandala save time. On hit, copies slots into
 * recommendation_cache under the new mandala_id and publishes card_added
 * events through the existing cardPublisher bus (same mechanism the
 * post-creation pipeline uses, so the dashboard/SSE consumer code path is
 * unchanged).
 *
 * Miss semantics are explicit (see `reason` enum). Callers SHOULD fall back
 * to `triggerMandalaPostCreationAsync` on miss so dashboard still fills via
 * the legacy path.
 *
 * Never throws — all errors produce `{ consumed: false, reason }`.
 */
export async function consumePrecompute(
  input: ConsumePrecomputeInput
): Promise<ConsumePrecomputeResult> {
  const cfg = loadWizardPrecomputeConfig();
  if (!cfg.enabled) return { consumed: false, reason: 'disabled' };
  if (!input.sessionId) return { consumed: false, reason: 'no-session-id' };

  const db = getPrismaClient();
  let row = await db.mandala_wizard_precompute.findUnique({
    where: { session_id: input.sessionId },
  });

  if (!row) return { consumed: false, reason: 'not-found' };
  if (row.user_id !== input.userId) {
    log.warn(
      `precompute user mismatch: session=${input.sessionId} row.user=${row.user_id} req.user=${input.userId}`
    );
    return { consumed: false, reason: 'wrong-user' };
  }

  // CP424.2 race handling: fast user clicks Step 3 save while startPrecompute
  // is still mid-flight (status='pending' | 'running'). Design doc's "Step 2
  // review 5-20s" assumption is structurally wrong — don't depend on user
  // dwelling. Poll up to POLL_BUDGET_MS for the row to transition out of
  // running. If still running when budget exhausts → miss, legacy fallback.
  // Tier 2 discover observed 4.6s on first prod hit; 5s budget covers p95
  // with small margin, user perceives as part of existing save latency.
  const POLL_BUDGET_MS = 15_000;
  const POLL_INTERVAL_MS = 250;
  if (row.status === 'pending' || row.status === 'running') {
    const pollStart = Date.now();
    while (
      Date.now() - pollStart < POLL_BUDGET_MS &&
      (row.status === 'pending' || row.status === 'running')
    ) {
      await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      const refreshed = await db.mandala_wizard_precompute.findUnique({
        where: { session_id: input.sessionId },
      });
      if (!refreshed) {
        // Row vanished mid-poll (TTL sweep racing — unlikely within 5s).
        return { consumed: false, reason: 'not-found' };
      }
      row = refreshed;
    }
    log.info(
      `precompute poll-wait end: session=${input.sessionId} final_status=${row.status} waited_ms=${Date.now() - pollStart}`
    );
  }

  if (row.status !== 'done') return { consumed: false, reason: 'not-done' };
  if (row.expires_at.getTime() < Date.now()) return { consumed: false, reason: 'expired' };

  // Goal match: allow minor whitespace / case variance but reject substantive
  // edits. Design doc §Invalidation: "consumed 시점에 goal match 검사".
  const normalize = (s: string): string => s.trim().toLowerCase();
  if (normalize(row.goal) !== normalize(input.centerGoal)) {
    log.info(
      `precompute goal mismatch: session=${input.sessionId} expected="${row.goal.slice(0, 40)}" got="${input.centerGoal.slice(0, 40)}"`
    );
    return { consumed: false, reason: 'goal-mismatch' };
  }

  // Extract slots from discover_result JSON.
  const discover = row.discover_result as unknown as EphemeralDiscoverResult | null;
  const slots = discover?.slots ?? [];
  if (slots.length === 0) {
    // Mark consumed anyway so we don't retry a known-empty result; fall back.
    await db.mandala_wizard_precompute.update({
      where: { session_id: input.sessionId },
      data: {
        status: 'consumed',
        consumed_mandala_id: input.mandalaId,
        consumed_at: new Date(),
      },
    });
    return { consumed: false, reason: 'empty-slots', slotsCount: 0 };
  }

  // Copy slots → recommendation_cache. Use INSERT … ON CONFLICT DO NOTHING
  // so the unique (user_id, mandala_id, video_id) constraint silently dedupes
  // if somehow the row already exists.
  const expiresAt = new Date(Date.now() + TTL_DAYS * MS_PER_DAY);
  const slotResults = await Promise.all(
    slots.map(async (slot) => {
      try {
        await db.$executeRaw(
          Prisma.sql`
            INSERT INTO public.recommendation_cache (
              user_id, mandala_id, cell_index, keyword, video_id, title,
              thumbnail, channel, channel_subs, view_count, like_ratio,
              duration_sec, rec_score, rec_reason, weight_version, status, expires_at,
              published_at
            )
            VALUES (
              ${input.userId}::uuid,
              ${input.mandalaId}::uuid,
              ${slot.cellIndex},
              ${''},
              ${slot.videoId},
              ${slot.title},
              ${slot.thumbnail},
              ${slot.channelName},
              ${null},
              ${slot.viewCount ? BigInt(slot.viewCount) : null},
              ${null},
              ${slot.durationSec},
              ${slot.score},
              ${'realtime'},
              ${WEIGHT_VERSION},
              ${RECOMMENDATION_STATUS_PENDING},
              ${expiresAt},
              ${slot.publishedAt != null ? new Date(String(slot.publishedAt)) : null}
            )
            ON CONFLICT (user_id, mandala_id, video_id) DO NOTHING
          `
        );
        const payload: CardPayload = {
          id: randomUUID(),
          videoId: slot.videoId,
          title: slot.title,
          channel: slot.channelName ?? null,
          thumbnail: slot.thumbnail ?? null,
          durationSec: slot.durationSec ?? null,
          recScore: slot.score,
          cellIndex: slot.cellIndex,
          cellLabel: null,
          keyword: '',
          source: 'auto_recommend',
          recReason: 'realtime',
          publishedAt:
            typeof slot.publishedAt === 'string'
              ? slot.publishedAt
              : (slot.publishedAt?.toISOString() ?? null),
        };
        notifyCardAdded(input.mandalaId, payload);
        return true;
      } catch (err) {
        log.warn(
          `precompute consume upsert failed: session=${input.sessionId} video=${slot.videoId} error=${
            err instanceof Error ? err.message : String(err)
          }`
        );
        return false;
      }
    })
  );
  const inserted = slotResults.filter(Boolean).length;

  // Mark consumed.
  await db.mandala_wizard_precompute.update({
    where: { session_id: input.sessionId },
    data: {
      status: 'consumed',
      consumed_mandala_id: input.mandalaId,
      consumed_at: new Date(),
    },
  });

  log.info(
    `precompute consumed: session=${input.sessionId} mandala=${input.mandalaId} ` +
      `slots=${slots.length} inserted=${inserted}`
  );

  return { consumed: true, cardsInserted: inserted, slotsCount: slots.length };
}
