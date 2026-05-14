/**
 * Lemon Squeezy billing — shared types.
 * See docs/design/billing-lemonsqueezy-2026-05-13.md §3 L2.
 */

export const BILLING_PROVIDER = 'lemonsqueezy' as const;
export type BillingProvider = typeof BILLING_PROVIDER;

/** Status values pinned by `billing_subscriptions_status_chk` CHECK constraint. */
export const BILLING_SUBSCRIPTION_STATUSES = [
  'PENDING',
  'ACTIVE',
  'PAST_DUE',
  'CANCELLED',
  'EXPIRED',
  'PAUSED',
] as const;
export type BillingSubscriptionStatus = (typeof BILLING_SUBSCRIPTION_STATUSES)[number];

export type PlanCode = 'pro_monthly' | 'pro_yearly' | 'pro_lifetime';
export type PlanTier = 'pro' | 'lifetime';

export const PLAN_CODES: readonly PlanCode[] = [
  'pro_monthly',
  'pro_yearly',
  'pro_lifetime',
] as const;

export interface PlanCatalogEntry {
  variantId: string;
  planCode: PlanCode;
  tier: PlanTier;
  cardLimit: number;
  mandalaLimit: number;
}

/**
 * Lemon Squeezy webhook envelope.
 * `meta.custom_data.user_id` carries the Insighta user uuid we set at checkout.
 * `data.attributes` shape varies per event_name — narrow at handler boundary.
 */
export interface LemonSqueezyWebhookEvent<TAttributes = Record<string, unknown>> {
  meta: {
    event_name: string;
    test_mode?: boolean;
    custom_data?: {
      user_id?: string;
    };
  };
  data: {
    id: string;
    type: string;
    attributes: TAttributes;
  };
}

/** Subset of LS subscription attributes we read from webhook. */
export interface LSSubscriptionAttributes {
  store_id?: number;
  customer_id?: number;
  variant_id?: number;
  status?: string;
  cancelled?: boolean;
  renews_at?: string | null;
  ends_at?: string | null;
  trial_ends_at?: string | null;
  created_at?: string;
  updated_at?: string;
  first_subscription_item?: {
    price?: number;
  } | null;
}

/** Subset of LS order attributes (order_created, order_refunded). */
export interface LSOrderAttributes {
  store_id?: number;
  customer_id?: number;
  identifier?: string;
  status?: string;
  refunded?: boolean;
  total?: number;
  currency?: string;
}

/** Input passed to subscription-service from webhook handler. */
export interface SubscriptionUpsertInput {
  userId: string;
  providerSubscriptionId: string;
  providerCustomerId?: string | null;
  variantId: string;
  planCode: PlanCode;
  status: BillingSubscriptionStatus;
  currentPeriodStart?: Date | null;
  currentPeriodEnd?: Date | null;
  cancelAtPeriodEnd: boolean;
  cancelledAt?: Date | null;
  amountCents: number;
  currency: string;
}
