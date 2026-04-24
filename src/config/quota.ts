/**
 * Quota & Rate Limit Constants
 *
 * SSOT: docs/policies/quota-policy.md
 * All tier-based limits and rate limits are defined here.
 * Do NOT hardcode quota values elsewhere — import from this module.
 */

export type Tier = 'free' | 'pro' | 'lifetime' | 'admin';

export const DEFAULT_TIER: Tier = 'free';

/** Skill summary quality modes */
export type SummaryMode = 'one_liner' | 'structured';

/** Skill target scope for recommendations */
export type TargetScope = 'single_cell' | 'all_mandalas';

/** Skill report depth levels */
export type ReportDepth = 'basic' | 'full';

/** Newsletter frequency options */
export type NewsletterFrequency = 'weekly' | 'daily';

/** Alert channel options */
export type AlertChannel = 'email' | 'push';

/** Skill limits shape per tier */
export interface SkillLimits {
  newsletter: {
    monthlyRuns: number | null;
    frequency: readonly NewsletterFrequency[];
    summaryMode: SummaryMode;
    curationTopN: number | null;
    biasReport: boolean;
    customTemplate: boolean;
    targetMandalas: number | null;
  };
  report: {
    monthlyRuns: number | null;
    depth: ReportDepth;
    maxCards: number;
  };
  alert: {
    monthlyRuns: number | null;
    channels: readonly AlertChannel[];
  };
  recommend: {
    dailyItems: number | null;
    targetScope: TargetScope;
  };
  script: {
    monthlyRuns: number | null;
    maxCards: number;
  };
  blog: {
    monthlyRuns: number | null;
    maxCards: number;
  };
}

/** Resource limits shape per tier */
export interface TierLimitConfig {
  mandalas: number | null;
  cards: number | null;
  aiSummaries: number | null;
  /**
   * Rich summary generations per calendar month (CP423).
   * Tracks LLM-expensive long-form (chapters/quotes/tl_dr) generations.
   * `null` = unlimited. Separate from `aiSummaries` (short summary quota).
   */
  richSummaries: number | null;
  weeklyReports: number | null;
  skills: SkillLimits;
}

/** Resource limits per tier. `null` means unlimited. */
export const TIER_LIMITS: Record<Tier, TierLimitConfig> = {
  free: {
    mandalas: 3,
    cards: 150,
    aiSummaries: 150,
    richSummaries: 30,
    weeklyReports: 10,
    skills: {
      newsletter: {
        monthlyRuns: 4,
        frequency: ['weekly'],
        summaryMode: 'one_liner',
        curationTopN: 3,
        biasReport: false,
        customTemplate: false,
        targetMandalas: 1,
      },
      report: {
        monthlyRuns: 1,
        depth: 'basic',
        maxCards: 50,
      },
      alert: {
        monthlyRuns: 20,
        channels: ['email'],
      },
      recommend: {
        dailyItems: 3,
        targetScope: 'single_cell',
      },
      script: {
        monthlyRuns: 2,
        maxCards: 30,
      },
      blog: {
        monthlyRuns: 2,
        maxCards: 30,
      },
    },
  },
  pro: {
    mandalas: 20,
    cards: 1_000,
    aiSummaries: 1_000,
    richSummaries: 200,
    weeklyReports: null,
    skills: {
      newsletter: {
        monthlyRuns: null,
        frequency: ['weekly', 'daily'],
        summaryMode: 'structured',
        curationTopN: 5,
        biasReport: true,
        customTemplate: true,
        targetMandalas: null,
      },
      report: {
        monthlyRuns: null,
        depth: 'full',
        maxCards: 200,
      },
      alert: {
        monthlyRuns: null,
        channels: ['email', 'push'],
      },
      recommend: {
        dailyItems: 10,
        targetScope: 'all_mandalas',
      },
      script: {
        monthlyRuns: null,
        maxCards: 100,
      },
      blog: {
        monthlyRuns: null,
        maxCards: 100,
      },
    },
  },
  lifetime: {
    mandalas: null,
    cards: null,
    aiSummaries: null,
    richSummaries: null,
    weeklyReports: null,
    skills: {
      newsletter: {
        monthlyRuns: null,
        frequency: ['weekly', 'daily'],
        summaryMode: 'structured',
        curationTopN: 5,
        biasReport: true,
        customTemplate: true,
        targetMandalas: null,
      },
      report: { monthlyRuns: null, depth: 'full', maxCards: 500 },
      alert: { monthlyRuns: null, channels: ['email', 'push'] },
      recommend: { dailyItems: null, targetScope: 'all_mandalas' },
      script: { monthlyRuns: null, maxCards: 300 },
      blog: { monthlyRuns: null, maxCards: 300 },
    },
  },
  admin: {
    mandalas: null,
    cards: null,
    aiSummaries: null,
    richSummaries: null,
    weeklyReports: null,
    skills: {
      newsletter: {
        monthlyRuns: null,
        frequency: ['weekly', 'daily'],
        summaryMode: 'structured',
        curationTopN: null,
        biasReport: true,
        customTemplate: true,
        targetMandalas: null,
      },
      report: { monthlyRuns: null, depth: 'full', maxCards: 500 },
      alert: { monthlyRuns: null, channels: ['email', 'push'] },
      recommend: { dailyItems: null, targetScope: 'all_mandalas' },
      script: { monthlyRuns: null, maxCards: 500 },
      blog: { monthlyRuns: null, maxCards: 500 },
    },
  },
};

/** DB sentinel value for unlimited resource limits (null tiers store this in DB) */
export const UNLIMITED_LIMIT = 999_999;

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
