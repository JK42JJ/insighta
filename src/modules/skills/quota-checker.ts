/**
 * Skill Quota Checker
 *
 * Verifies whether a user has remaining monthly execution quota
 * for a given skill before SkillRegistry runs it.
 *
 * Policy SSOT: docs/policies/skill-quota-policy.md
 * Limit constants SSOT: src/config/quota.ts
 *
 * Counting logic:
 *  - Window: 1st of current month 00:00:00 UTC → now
 *  - Counted statuses: 'success' | 'running'
 *  - null limit → unlimited (always allowed)
 */

import { getPrismaClient } from '@/modules/database';
import { TIER_LIMITS, type Tier } from '@/config/quota';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface QuotaCheckResult {
  allowed: boolean;
  /** Human-readable reason when allowed is false */
  reason?: string;
  /** Remaining runs this month. Undefined when unlimited. */
  remaining?: number;
}

/** Skills that have a monthlyRuns limit tracked via skill_runs table */
export type SkillId = 'newsletter' | 'report' | 'alert';

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Checks whether `userId` (on `tier`) may execute `skillId` right now.
 *
 * @param skillId - Skill to check ('newsletter' | 'report' | 'alert')
 * @param userId  - UUID of the requesting user
 * @param tier    - User's subscription tier
 * @returns QuotaCheckResult with allowed flag, optional reason, and remaining count
 */
export async function checkSkillQuota(
  skillId: SkillId,
  userId: string,
  tier: Tier
): Promise<QuotaCheckResult> {
  const skillLimits = TIER_LIMITS[tier].skills[skillId];
  const limit = skillLimits.monthlyRuns;

  // null → unlimited tier; skip DB query entirely
  if (limit === null) {
    return { allowed: true };
  }

  const db = getPrismaClient();

  const startOfMonth = new Date();
  startOfMonth.setUTCDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);

  const count = await db.skill_runs.count({
    where: {
      skill_id: skillId,
      user_id: userId,
      status: { in: ['success', 'running'] },
      started_at: { gte: startOfMonth },
    },
  });

  if (count >= limit) {
    return {
      allowed: false,
      reason: `Monthly limit exceeded (${count}/${limit})`,
      remaining: 0,
    };
  }

  return { allowed: true, remaining: limit - count };
}
