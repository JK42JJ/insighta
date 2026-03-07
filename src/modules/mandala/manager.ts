import { getPrismaClient } from '../database/client';
import { logger } from '../../utils/logger';
import { user_mandalas } from '@prisma/client';

const MANDALA_QUOTA = {
  free: 3,
  premium: 50,
} as const;

interface MandalaLevelData {
  levelKey: string;
  centerGoal: string;
  subjects: string[];
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
  position: number;
  createdAt: Date;
  updatedAt: Date;
  levels: {
    id: string;
    levelKey: string;
    centerGoal: string;
    subjects: string[];
    position: number;
    depth: number;
    color: string | null;
    parentLevelId: string | null;
  }[];
}

interface ListMandalasResult {
  mandalas: MandalaWithLevels[];
  total: number;
  page: number;
  limit: number;
}

interface UserQuota {
  tier: string;
  limit: number;
  used: number;
  remaining: number;
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
        subjects: string[];
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
      position: mandala.position,
      createdAt: mandala.created_at,
      updatedAt: mandala.updated_at,
      levels: mandala.levels.map((l) => ({
        id: l.id,
        levelKey: l.level_key,
        centerGoal: l.center_goal,
        subjects: l.subjects,
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
    const levelIdMap = new Map<string, string>();

    const rootLevel = levels.find((l) => l.depth === 0);
    if (rootLevel) {
      const created = await tx.user_mandala_levels.create({
        data: {
          mandala_id: mandalaId,
          level_key: rootLevel.levelKey,
          center_goal: rootLevel.centerGoal,
          subjects: rootLevel.subjects,
          position: rootLevel.position,
          depth: rootLevel.depth,
          color: rootLevel.color,
        },
      });
      levelIdMap.set(rootLevel.levelKey, created.id);
    }

    const childLevels = levels.filter((l) => l.depth > 0);
    for (const level of childLevels) {
      const parentId = level.parentLevelKey ? (levelIdMap.get(level.parentLevelKey) ?? null) : null;

      const created = await tx.user_mandala_levels.create({
        data: {
          mandala_id: mandalaId,
          parent_level_id: parentId,
          level_key: level.levelKey,
          center_goal: level.centerGoal,
          subjects: level.subjects,
          position: level.position,
          depth: level.depth,
          color: level.color,
        },
      });
      levelIdMap.set(level.levelKey, created.id);
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
    const limit = options?.limit ?? 20;
    const skip = (page - 1) * limit;

    const [mandalas, total] = await Promise.all([
      this.prisma.user_mandalas.findMany({
        where: { user_id: userId },
        include: {
          levels: {
            orderBy: [{ depth: 'asc' }, { position: 'asc' }],
          },
        },
        orderBy: [{ is_default: 'desc' }, { position: 'asc' }, { created_at: 'desc' }],
        skip,
        take: limit,
      }),
      this.prisma.user_mandalas.count({
        where: { user_id: userId },
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
   * Creates a new mandala with tier-based quota enforcement.
   * The quota check and insert are atomic inside a transaction.
   */
  async createMandala(
    userId: string,
    title: string,
    levels: MandalaLevelData[]
  ): Promise<MandalaWithLevels> {
    return await this.prisma.$transaction(async (tx) => {
      // Resolve user tier
      const subscription = await tx.user_subscriptions.findUnique({
        where: { user_id: userId },
        select: { tier: true },
      });
      const tier = (subscription?.tier ?? 'free') as keyof typeof MANDALA_QUOTA;
      const limit = MANDALA_QUOTA[tier] ?? MANDALA_QUOTA.free;

      // Count existing mandalas (quota check inside transaction for atomicity)
      const count = await tx.user_mandalas.count({
        where: { user_id: userId },
      });

      if (count >= limit) {
        const err = new Error('Mandala quota exceeded') as Error & {
          quota: number;
          current: number;
        };
        err.quota = limit;
        err.current = count;
        throw err;
      }

      // Determine position and isDefault
      const isDefault = count === 0;
      const maxPositionResult = await tx.user_mandalas.aggregate({
        where: { user_id: userId },
        _max: { position: true },
      });
      const position = (maxPositionResult._max.position ?? -1) + 1;

      // Create the mandala record
      const mandala = await tx.user_mandalas.create({
        data: {
          user_id: userId,
          title,
          is_default: isDefault,
          position,
        },
      });

      // Create levels using two-pass pattern
      await this.createLevels(tx as any, mandala.id, levels);

      logger.info(`Mandala created: userId=${userId}, mandalaId=${mandala.id}, tier=${tier}`);

      // Fetch and return the complete result
      const result = await tx.user_mandalas.findUnique({
        where: { id: mandala.id },
        include: {
          levels: {
            orderBy: [{ depth: 'asc' }, { position: 'asc' }],
          },
        },
      });

      if (!result) {
        throw new Error('Failed to create mandala');
      }

      return this.mapMandala(result);
    });
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
    return await this.prisma.$transaction(async (tx) => {
      await this.verifyOwnership(userId, mandalaId, tx as any);

      if (data.isDefault === true) {
        // Demote all other mandalas for this user
        await tx.user_mandalas.updateMany({
          where: { user_id: userId, id: { not: mandalaId } },
          data: { is_default: false },
        });
      }

      await tx.user_mandalas.update({
        where: { id: mandalaId },
        data: {
          ...(data.title !== undefined && { title: data.title }),
          ...(data.isDefault !== undefined && { is_default: data.isDefault }),
          ...(data.position !== undefined && { position: data.position }),
          updated_at: new Date(),
        },
      });

      logger.info(`Mandala updated: userId=${userId}, mandalaId=${mandalaId}`);

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
   * Replaces all levels of a specific mandala.
   * Verifies ownership, deletes existing levels, recreates with two-pass pattern.
   */
  async updateMandalaLevels(
    userId: string,
    mandalaId: string,
    levels: MandalaLevelData[]
  ): Promise<MandalaWithLevels> {
    return await this.prisma.$transaction(async (tx) => {
      await this.verifyOwnership(userId, mandalaId, tx as any);

      // Delete and recreate levels
      await tx.user_mandala_levels.deleteMany({
        where: { mandala_id: mandalaId },
      });

      await this.createLevels(tx as any, mandalaId, levels);

      // Touch updated_at on parent mandala
      await tx.user_mandalas.update({
        where: { id: mandalaId },
        data: { updated_at: new Date() },
      });

      logger.info(`Mandala levels updated: userId=${userId}, mandalaId=${mandalaId}`);

      const result = await tx.user_mandalas.findUnique({
        where: { id: mandalaId },
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
    });
  }

  /**
   * Deletes a mandala. If it was the default and other mandalas exist,
   * promotes the next one (lowest position) to default.
   */
  async deleteMandala(userId: string, mandalaId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const mandala = await this.verifyOwnership(userId, mandalaId, tx as any);

      // If deleting the default mandala, promote the next candidate
      if (mandala.is_default) {
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
        where: { id: mandalaId },
      });

      logger.info(`Mandala deleted: userId=${userId}, mandalaId=${mandalaId}`);
    });
  }

  /**
   * Returns quota information for the user.
   */
  async getUserQuota(userId: string): Promise<UserQuota> {
    const [subscription, used] = await Promise.all([
      this.prisma.user_subscriptions.findUnique({
        where: { user_id: userId },
        select: { tier: true },
      }),
      this.prisma.user_mandalas.count({
        where: { user_id: userId },
      }),
    ]);

    const tier = (subscription?.tier ?? 'free') as keyof typeof MANDALA_QUOTA;
    const limit = MANDALA_QUOTA[tier] ?? MANDALA_QUOTA.free;

    return {
      tier,
      limit,
      used,
      remaining: Math.max(0, limit - used),
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
    return await this.prisma.$transaction(async (tx) => {
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

      // Delete existing levels and recreate
      await tx.user_mandala_levels.deleteMany({
        where: { mandala_id: mandala.id },
      });

      // First pass: create root level
      const rootLevel = levels.find((l) => l.depth === 0);
      const levelIdMap = new Map<string, string>();

      if (rootLevel) {
        const created = await tx.user_mandala_levels.create({
          data: {
            mandala_id: mandala.id,
            level_key: rootLevel.levelKey,
            center_goal: rootLevel.centerGoal,
            subjects: rootLevel.subjects,
            position: rootLevel.position,
            depth: rootLevel.depth,
            color: rootLevel.color,
          },
        });
        levelIdMap.set(rootLevel.levelKey, created.id);
      }

      // Second pass: create child levels
      const childLevels = levels.filter((l) => l.depth > 0);
      for (const level of childLevels) {
        const parentId = level.parentLevelKey
          ? (levelIdMap.get(level.parentLevelKey) ?? null)
          : null;

        const created = await tx.user_mandala_levels.create({
          data: {
            mandala_id: mandala.id,
            parent_level_id: parentId,
            level_key: level.levelKey,
            center_goal: level.centerGoal,
            subjects: level.subjects,
            position: level.position,
            depth: level.depth,
            color: level.color,
          },
        });
        levelIdMap.set(level.levelKey, created.id);
      }

      // Fetch the complete result
      const result = await this.getMandala(userId);
      if (!result) {
        throw new Error('Failed to create mandala');
      }

      logger.info(`Mandala upserted: userId=${userId}, mandalaId=${mandala.id}`);
      return result;
    });
  }

  /**
   * Updates a single level on the default mandala for a user. Backward-compatible.
   */
  async updateLevel(
    userId: string,
    levelKey: string,
    data: { centerGoal?: string; subjects?: string[]; color?: string | null }
  ): Promise<void> {
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
  }
}
