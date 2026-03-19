/**
 * Quota & Rate Limit Constants
 *
 * SSOT: docs/policies/quota-policy.md
 * All tier-based limits and rate limits are defined here.
 * Do NOT hardcode quota values elsewhere — import from this module.
 */

export type Tier = 'free' | 'pro' | 'lifetime' | 'admin';

export const DEFAULT_TIER: Tier = 'free';

/** Resource limits per tier. `null` means unlimited. */
export const TIER_LIMITS = {
  free: {
    mandalas: 3,
    cards: 150,
    aiSummaries: 150,
    weeklyReports: 10,
  },
  pro: {
    mandalas: 20,
    cards: 1_000,
    aiSummaries: 1_000,
    weeklyReports: null,
  },
  lifetime: {
    mandalas: null,
    cards: null,
    aiSummaries: null,
    weeklyReports: null,
  },
  admin: {
    mandalas: null,
    cards: null,
    aiSummaries: null,
    weeklyReports: null,
  },
} as const satisfies Record<Tier, Record<string, number | null>>;

/** Global API rate limits per tier (requests per minute). `null` means unlimited. */
export const TIER_RATE_LIMITS: Record<Tier, number | null> = {
  free: 100,
  pro: 300,
  lifetime: null,
  admin: null,
};

/** Helper: get mandala limit for a tier (returns Infinity for unlimited) */
export function getMandalaLimit(tier: Tier): number {
  return TIER_LIMITS[tier].mandalas ?? Infinity;
}

/** Helper: get cards limit for a tier (returns Infinity for unlimited) */
export function getCardsLimit(tier: Tier): number {
  return TIER_LIMITS[tier].cards ?? Infinity;
}

/** Helper: get rate limit max for a tier (returns 0 to indicate unlimited) */
export function getRateLimitMax(tier: Tier): number {
  return TIER_RATE_LIMITS[tier] ?? 0;
}
