export const SUBSCRIPTION_TIERS = {
  free: { cardLimit: 150, mandalaLimit: 3 },
  premium: { cardLimit: 1000, mandalaLimit: 50 },
  admin: { cardLimit: 10000, mandalaLimit: 200 },
} as const;

export type SubscriptionTier = keyof typeof SUBSCRIPTION_TIERS;
export const DEFAULT_TIER: SubscriptionTier = 'free';
export const DEFAULT_CARD_LIMIT = SUBSCRIPTION_TIERS[DEFAULT_TIER].cardLimit;
export const DEFAULT_MANDALA_LIMIT = SUBSCRIPTION_TIERS[DEFAULT_TIER].mandalaLimit;
