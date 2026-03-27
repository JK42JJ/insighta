/**
 * Subscription tier constants (frontend).
 *
 * SSOT: src/config/quota.ts (backend) + docs/policies/quota-policy.md
 * Keep in sync when tiers or limits change.
 */

export type SubscriptionTier = 'free' | 'pro' | 'lifetime' | 'admin';

export const SUBSCRIPTION_TIERS: Record<SubscriptionTier, { cardLimit: number | null; mandalaLimit: number | null }> = {
  free: { cardLimit: 150, mandalaLimit: 3 },
  pro: { cardLimit: 1_000, mandalaLimit: 20 },
  lifetime: { cardLimit: null, mandalaLimit: null },
  admin: { cardLimit: null, mandalaLimit: null },
} as const;

export const DEFAULT_TIER: SubscriptionTier = 'free';
export const DEFAULT_CARD_LIMIT = SUBSCRIPTION_TIERS[DEFAULT_TIER].cardLimit!;
export const DEFAULT_MANDALA_LIMIT = SUBSCRIPTION_TIERS[DEFAULT_TIER].mandalaLimit!;
