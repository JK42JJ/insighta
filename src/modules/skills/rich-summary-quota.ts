/**
 * Rich Summary quota (CP423).
 *
 * Per-tier monthly limits for rich summary generation:
 *   free      → 30 / month
 *   pro       → 200 / month
 *   lifetime  → unlimited
 *   admin     → unlimited
 *
 * SSOT: `TIER_LIMITS[tier].richSummaries` in `src/config/quota.ts`.
 *
 * Usage counting: rows in `video_rich_summaries` with
 *   user_id = <userId> AND updated_at >= first day of current UTC month
 *   AND quality_flag IN ('pass', 'low')   (any successful generation counts)
 *
 * Cache hits (existing passing row reused) do NOT count — enrichRichSummary
 * short-circuits before reaching the quota check when cache matches.
 */

import { TIER_LIMITS, type Tier, DEFAULT_TIER } from '@/config/quota';
import type { PrismaClient } from '@prisma/client';
import { AppError, ErrorSeverity } from '@/utils/errors';

export class RichSummaryQuotaExceededError extends AppError {
  constructor(details: { userId: string; tier: Tier; used: number; limit: number }) {
    super(
      `Rich summary monthly quota exceeded (tier=${details.tier}, used=${details.used}/${details.limit})`,
      'RICH_SUMMARY_QUOTA_EXCEEDED',
      429,
      true,
      details,
      ErrorSeverity.MEDIUM,
      false
    );
  }
}

function startOfCurrentMonthUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export async function getUserTier(prisma: PrismaClient, userId: string): Promise<Tier> {
  const sub = await prisma.user_subscriptions.findUnique({
    where: { user_id: userId },
    select: { tier: true },
  });
  const raw = sub?.tier ?? DEFAULT_TIER;
  if (raw === 'free' || raw === 'pro' || raw === 'lifetime' || raw === 'admin') return raw;
  return DEFAULT_TIER;
}

export async function countRichSummariesThisMonth(
  prisma: PrismaClient,
  userId: string
): Promise<number> {
  return prisma.video_rich_summaries.count({
    where: {
      user_id: userId,
      updated_at: { gte: startOfCurrentMonthUtc() },
      quality_flag: { in: ['pass', 'low'] },
    },
  });
}

/**
 * Enforce per-user monthly rich summary quota.
 * Throws RichSummaryQuotaExceededError when user has reached the tier cap.
 * Returns { tier, used, limit } on success for logging.
 */
export async function assertRichSummaryQuota(
  prisma: PrismaClient,
  userId: string
): Promise<{ tier: Tier; used: number; limit: number | null }> {
  const tier = await getUserTier(prisma, userId);
  const limit = TIER_LIMITS[tier].richSummaries;
  if (limit === null) {
    return { tier, used: 0, limit: null };
  }
  const used = await countRichSummariesThisMonth(prisma, userId);
  if (used >= limit) {
    throw new RichSummaryQuotaExceededError({ userId, tier, used, limit });
  }
  return { tier, used, limit };
}
