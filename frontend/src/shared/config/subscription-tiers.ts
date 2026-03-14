export const SUBSCRIPTION_TIERS = {
  free: { limit: 100 },
  premium: { limit: 1000 },
  admin: { limit: 10000 },
} as const;

export type SubscriptionTier = keyof typeof SUBSCRIPTION_TIERS;
export const DEFAULT_TIER: SubscriptionTier = 'free';
export const DEFAULT_CARD_LIMIT = SUBSCRIPTION_TIERS[DEFAULT_TIER].limit;
