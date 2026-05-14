/**
 * billing_subscriptions + user_subscriptions DB sync service.
 *
 * Webhook handler computes a SubscriptionUpsertInput (status + period + cancel
 * flags) and hands it to upsertSubscription(). We then:
 *   1. UPSERT into billing_subscriptions on (provider, provider_subscription_id).
 *   2. Sync user_subscriptions.tier per ADR-12:
 *      - ACTIVE / PAST_DUE / PAUSED / CANCELLED (with cancel_at_period_end and current_period_end > now) → tier = catalog.tier
 *      - EXPIRED → tier = 'free'
 *      - PENDING → no tier change (checkout in flight, do not pre-grant).
 *
 * `user_subscriptions` row is created if missing (`upsert` on user_id @unique).
 */

import { db } from '@/modules/database/client';
import { logger } from '@/utils/logger';
import { findPlanByVariantId } from './plan-catalog';
import { BILLING_PROVIDER } from './types';
import type { SubscriptionUpsertInput, BillingSubscriptionStatus, PlanTier } from './types';
import { TIER_LIMITS } from '@/config/quota';

export async function upsertSubscription(input: SubscriptionUpsertInput): Promise<void> {
  await db.billing_subscriptions.upsert({
    where: {
      provider_provider_subscription_id: {
        provider: BILLING_PROVIDER,
        provider_subscription_id: input.providerSubscriptionId,
      },
    },
    create: {
      user_id: input.userId,
      provider: BILLING_PROVIDER,
      provider_subscription_id: input.providerSubscriptionId,
      provider_customer_id: input.providerCustomerId ?? null,
      variant_id: input.variantId,
      plan_code: input.planCode,
      status: input.status,
      current_period_start: input.currentPeriodStart ?? null,
      current_period_end: input.currentPeriodEnd ?? null,
      cancel_at_period_end: input.cancelAtPeriodEnd,
      cancelled_at: input.cancelledAt ?? null,
      amount_cents: input.amountCents,
      currency: input.currency,
    },
    update: {
      provider_customer_id: input.providerCustomerId ?? undefined,
      variant_id: input.variantId,
      plan_code: input.planCode,
      status: input.status,
      current_period_start: input.currentPeriodStart ?? null,
      current_period_end: input.currentPeriodEnd ?? null,
      cancel_at_period_end: input.cancelAtPeriodEnd,
      cancelled_at: input.cancelledAt ?? null,
      amount_cents: input.amountCents,
      currency: input.currency,
    },
  });

  await syncUserTier(input.userId, input.status, input.variantId);

  logger.info('billing.subscription upserted', {
    user_id: input.userId,
    provider_subscription_id: input.providerSubscriptionId,
    status: input.status,
  });
}

/**
 * Derive the user-facing tier from subscription status + variant.
 * Writes only when the new tier differs from the stored one.
 */
async function syncUserTier(
  userId: string,
  status: BillingSubscriptionStatus,
  variantId: string
): Promise<void> {
  const targetTier = resolveTierForStatus(status, variantId);
  if (targetTier == null) return; // PENDING — no change

  const existing = await db.user_subscriptions.findUnique({ where: { user_id: userId } });
  if (existing && existing.tier === targetTier) return;

  const limits = TIER_LIMITS[targetTier];
  await db.user_subscriptions.upsert({
    where: { user_id: userId },
    create: {
      user_id: userId,
      tier: targetTier,
      local_cards_limit: limits.cards,
      mandala_limit: limits.mandalas,
    },
    update: {
      tier: targetTier,
      local_cards_limit: limits.cards,
      mandala_limit: limits.mandalas,
      updated_at: new Date(),
    },
  });
}

function resolveTierForStatus(
  status: BillingSubscriptionStatus,
  variantId: string
): PlanTier | 'free' | null {
  switch (status) {
    case 'ACTIVE':
    case 'PAST_DUE':
    case 'PAUSED':
    case 'CANCELLED': {
      const plan = findPlanByVariantId(variantId);
      return plan?.tier ?? 'free';
    }
    case 'EXPIRED':
      return 'free';
    case 'PENDING':
      return null;
  }
}

/**
 * Lifetime one-time order handler.
 * LS sends `order_created` (not `subscription_*`) — there is no subscription row to
 * rotate, so we (1) insert a synthetic `billing_subscriptions` row with status=ACTIVE,
 * no period_end, cancel_at_period_end=false, and (2) flip `user_subscriptions.tier='lifetime'`.
 * idempotency: provider_subscription_id uses the LS order id, the UNIQUE constraint
 * guards against duplicate processing.
 */
export async function applyLifetimeOrder(input: {
  userId: string;
  providerOrderId: string;
  providerCustomerId?: string | null;
  variantId: string;
  amountCents: number;
  currency: string;
}): Promise<void> {
  await db.billing_subscriptions.upsert({
    where: {
      provider_provider_subscription_id: {
        provider: BILLING_PROVIDER,
        provider_subscription_id: input.providerOrderId,
      },
    },
    create: {
      user_id: input.userId,
      provider: BILLING_PROVIDER,
      provider_subscription_id: input.providerOrderId,
      provider_customer_id: input.providerCustomerId ?? null,
      variant_id: input.variantId,
      plan_code: 'pro_lifetime',
      status: 'ACTIVE',
      current_period_start: new Date(),
      current_period_end: null,
      cancel_at_period_end: false,
      amount_cents: input.amountCents,
      currency: input.currency,
    },
    update: {
      provider_customer_id: input.providerCustomerId ?? undefined,
      status: 'ACTIVE',
    },
  });

  const limits = TIER_LIMITS.lifetime;
  await db.user_subscriptions.upsert({
    where: { user_id: input.userId },
    create: {
      user_id: input.userId,
      tier: 'lifetime',
      local_cards_limit: limits.cards,
      mandala_limit: limits.mandalas,
    },
    update: {
      tier: 'lifetime',
      local_cards_limit: limits.cards,
      mandala_limit: limits.mandalas,
      updated_at: new Date(),
    },
  });

  logger.info('billing.lifetime applied', {
    user_id: input.userId,
    provider_order_id: input.providerOrderId,
  });
}

export async function findActiveSubscriptionByUser(userId: string) {
  return db.billing_subscriptions.findFirst({
    where: {
      user_id: userId,
      status: { in: ['ACTIVE', 'PAST_DUE', 'PAUSED'] },
    },
    orderBy: { created_at: 'desc' },
  });
}
