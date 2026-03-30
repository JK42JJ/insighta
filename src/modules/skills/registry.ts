/**
 * Skill Registry — Singleton skill manager
 *
 * Manages skill registration, lookup, and execution with
 * automatic skill_runs table logging.
 *
 * Design: docs/design/skill-registry-handoff.md
 * Issue: #337 (Step 2)
 */

import type { Prisma } from '@prisma/client';
import { getPrismaClient } from '@/modules/database';
import { checkSkillQuota, type SkillId } from './quota-checker';
import { logger } from '@/utils/logger';
import type { InsightaSkill, SkillContext, SkillResult } from './types';

const log = logger.child({ module: 'SkillRegistry' });

class SkillRegistry {
  private skills = new Map<string, InsightaSkill>();

  register(skill: InsightaSkill): void {
    this.skills.set(skill.id, skill);
    log.info(`Skill registered: ${skill.id} v${skill.version}`);
  }

  get(skillId: string): InsightaSkill | undefined {
    return this.skills.get(skillId);
  }

  listAll(): InsightaSkill[] {
    return Array.from(this.skills.values());
  }

  /** List skills available for the given tier */
  listForTier(tier: string): InsightaSkill[] {
    return this.listAll().filter((s) => s.tiers.includes(tier as never));
  }

  /** Execute a skill with automatic skill_runs logging */
  async execute(skillId: string, ctx: SkillContext): Promise<SkillResult> {
    const skill = this.skills.get(skillId);
    if (!skill) {
      return { success: false, error: `Skill not found: ${skillId}` };
    }

    const db = getPrismaClient();

    // Quota guard — check before any DB writes
    const QUOTA_SKILLS: SkillId[] = ['newsletter', 'report', 'alert', 'script', 'blog'];
    if (QUOTA_SKILLS.includes(skillId as SkillId)) {
      const quota = await checkSkillQuota(skillId as SkillId, ctx.userId, ctx.tier);
      if (!quota.allowed) {
        return {
          success: false,
          error: quota.reason,
          metadata: { duration_ms: 0, quota_exceeded: true },
        };
      }
    }

    // Record execution start
    const run = await db.skill_runs.create({
      data: {
        skill_id: skillId,
        user_id: ctx.userId,
        status: 'running',
        input: {
          mandalaId: ctx.mandalaId,
          tier: ctx.tier,
          params: ctx.params ?? null,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    try {
      const result = await skill.execute(ctx);

      await db.skill_runs.update({
        where: { id: run.id },
        data: {
          status: result.success ? 'success' : 'failed',
          output: (result.data ?? {}) as unknown as Prisma.InputJsonValue,
          error: result.error,
          ended_at: new Date(),
        },
      });

      return result;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log.error(`Skill execution failed: ${skillId}`, { error, userId: ctx.userId });

      await db.skill_runs.update({
        where: { id: run.id },
        data: { status: 'failed', error, ended_at: new Date() },
      });

      return { success: false, error };
    }
  }
}

/** Singleton instance */
export const skillRegistry = new SkillRegistry();
