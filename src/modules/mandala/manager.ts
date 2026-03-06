import { getPrismaClient } from '../database/client';
import { logger } from '../../utils/logger';

interface MandalaLevelData {
  levelKey: string;
  centerGoal: string;
  subjects: string[];
  position: number;
  depth: number;
  color?: string | null;
  parentLevelKey?: string | null;
}

interface MandalaWithLevels {
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
