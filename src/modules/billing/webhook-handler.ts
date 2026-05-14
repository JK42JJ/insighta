/**
 * Lemon Squeezy webhook event handler.
 *
 * Flow (called from route handler after signature verify + raw payload parse):
 *   1. INSERT into billing_events (idempotent via UNIQUE(provider, provider_event_id)).
 *      Duplicate event → return early, mark already_processed=true.
 *   2. Dispatch on meta.event_name → state transition via subscription-service.
 *   3. UPDATE billing_events SET processed_at=now() on success,
 *      or error_message on failure (no throw bubbles to LS; LS will retry on 5xx
 *      but we want explicit ledger).
 *
 * Unknown event_name → log + processed_at=now() (acked, no-op).
 * See docs/design/billing-lemonsqueezy-2026-05-13.md §3 L3 table.
 */

import { db } from '@/modules/database/client';
import { logger } from '@/utils/logger';
import { findPlanByVariantId } from './plan-catalog';
import { upsertSubscription, applyLifetimeOrder } from './subscription-service';
import { BILLING_PROVIDER } from './types';
import type {
  LemonSqueezyWebhookEvent,
  LSSubscriptionAttributes,
  LSOrderAttributes,
  BillingSubscriptionStatus,
} from './types';

export interface HandleEventInput {
  providerEventId: string;
  eventName: string;
  payload: LemonSqueezyWebhookEvent<unknown>;
  rawPayload: unknown;
  signatureOk: boolean;
}

export interface HandleEventResult {
  status: 'inserted' | 'duplicate' | 'invalid_signature';
  processed: boolean;
  error?: string;
}

/** Subscription lifecycle events that mutate billing_subscriptions row. */
const SUBSCRIPTION_LIFECYCLE_EVENTS = new Set([
  'subscription_created',
  'subscription_updated',
  'subscription_cancelled',
  'subscription_resumed',
  'subscription_expired',
  'subscription_paused',
  'subscription_unpaused',
  'subscription_payment_success',
  'subscription_payment_failed',
]);

export async function handleEvent(input: HandleEventInput): Promise<HandleEventResult> {
  // 1. Always log the event first (even when signature failed — audit trail).
  let eventRowId: string | null = null;
  try {
    const inserted = await db.billing_events.create({
      data: {
        provider: BILLING_PROVIDER,
        provider_event_id: input.providerEventId,
        event_name: input.eventName,
        payload: input.rawPayload as object,
        signature_ok: input.signatureOk,
      },
    });
    eventRowId = inserted.id;
  } catch (err) {
    // Unique violation → duplicate webhook (LS retry). Idempotent no-op.
    if (isUniqueViolation(err)) {
      logger.info('billing.webhook duplicate event ignored', {
        provider_event_id: input.providerEventId,
        event_name: input.eventName,
      });
      return { status: 'duplicate', processed: true };
    }
    logger.error('billing.webhook event log INSERT failed', { err });
    throw err;
  }

  // 2. If signature failed, do not transition state. Just leave the row
  //    with processed_at=null + signature_ok=false for audit.
  if (!input.signatureOk) {
    return { status: 'invalid_signature', processed: false };
  }

  // 3. Dispatch.
  try {
    if (SUBSCRIPTION_LIFECYCLE_EVENTS.has(input.eventName)) {
      await handleSubscriptionEvent(
        input.payload as LemonSqueezyWebhookEvent<LSSubscriptionAttributes>
      );
    } else if (input.eventName === 'order_created') {
      await handleOrderCreated(input.payload as LemonSqueezyWebhookEvent<LSOrderAttributes>);
    } else {
      logger.info('billing.webhook event acked (no handler)', { event_name: input.eventName });
    }
    await db.billing_events.update({
      where: { id: eventRowId },
      data: { processed_at: new Date() },
    });
    return { status: 'inserted', processed: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('billing.webhook handler failed', { err, event_name: input.eventName });
    await db.billing_events
      .update({
        where: { id: eventRowId },
        data: { error_message: message.slice(0, 1000) },
      })
      .catch(() => {
        /* swallow secondary failure */
      });
    return { status: 'inserted', processed: false, error: message };
  }
}

async function handleSubscriptionEvent(
  event: LemonSqueezyWebhookEvent<LSSubscriptionAttributes>
): Promise<void> {
  const userId = event.meta.custom_data?.user_id;
  if (!userId) {
    throw new Error('webhook missing custom_data.user_id');
  }
  const variantIdNum = event.data.attributes.variant_id;
  if (variantIdNum == null) {
    throw new Error('webhook missing data.attributes.variant_id');
  }
  const variantId = String(variantIdNum);
  const plan = findPlanByVariantId(variantId);
  if (!plan) {
    throw new Error(`unknown variant_id ${variantId} (not in plan-catalog for this env)`);
  }

  const attrs = event.data.attributes;
  const status = mapStatus(event.meta.event_name, attrs.status);
  const cancelled = !!attrs.cancelled || event.meta.event_name === 'subscription_cancelled';
  const renewsAt = attrs.renews_at ? new Date(attrs.renews_at) : null;
  const endsAt = attrs.ends_at ? new Date(attrs.ends_at) : null;

  await upsertSubscription({
    userId,
    providerSubscriptionId: event.data.id,
    providerCustomerId: attrs.customer_id != null ? String(attrs.customer_id) : null,
    variantId,
    planCode: plan.planCode,
    status,
    currentPeriodStart: attrs.created_at ? new Date(attrs.created_at) : null,
    currentPeriodEnd: renewsAt ?? endsAt,
    cancelAtPeriodEnd: cancelled && status !== 'EXPIRED',
    cancelledAt: cancelled && endsAt ? endsAt : null,
    amountCents: attrs.first_subscription_item?.price ?? 0,
    currency: 'USD', // LS variant currency — pinned via plan-catalog (ADR-10 USD)
  });
}

/**
 * Map LS event_name + attrs.status → our BillingSubscriptionStatus.
 * LS status strings: 'on_trial' | 'active' | 'paused' | 'past_due' | 'unpaid' | 'cancelled' | 'expired'.
 * Event_name takes priority for explicit transitions (expired / paused / etc).
 */
export function mapStatus(
  eventName: string,
  lsStatus: string | undefined
): BillingSubscriptionStatus {
  switch (eventName) {
    case 'subscription_expired':
      return 'EXPIRED';
    case 'subscription_paused':
      return 'PAUSED';
    case 'subscription_unpaused':
    case 'subscription_resumed':
      return 'ACTIVE';
    case 'subscription_cancelled':
      return 'CANCELLED';
    case 'subscription_payment_failed':
      return 'PAST_DUE';
  }
  // event_name is created/updated/payment_success → look at attrs.status.
  switch ((lsStatus ?? '').toLowerCase()) {
    case 'active':
    case 'on_trial':
      return 'ACTIVE';
    case 'past_due':
    case 'unpaid':
      return 'PAST_DUE';
    case 'paused':
      return 'PAUSED';
    case 'cancelled':
      return 'CANCELLED';
    case 'expired':
      return 'EXPIRED';
    default:
      return 'PENDING';
  }
}

/**
 * Lifetime one-time order: LS `order_created` event with a variant_id that
 * resolves to plan_code='pro_lifetime'. Recurring orders share the same event
 * (LS sends order_created for every monthly renewal too) — so we only flip the
 * tier to 'lifetime' when the catalog entry is the lifetime one. Other order
 * events are logged but no-op (subscription_* path owns recurring tier sync).
 */
async function handleOrderCreated(
  event: LemonSqueezyWebhookEvent<LSOrderAttributes>
): Promise<void> {
  const userId = event.meta.custom_data?.user_id;
  if (!userId) {
    throw new Error('order_created missing custom_data.user_id');
  }
  // LS embeds the purchased variant inside `first_order_item` for orders.
  const firstItem = (
    event.data.attributes as unknown as {
      first_order_item?: { variant_id?: number | string };
    }
  ).first_order_item;
  const variantIdRaw = firstItem?.variant_id;
  if (variantIdRaw == null) {
    logger.info('order_created without first_order_item.variant_id — acked, no-op', {
      data_id: event.data.id,
    });
    return;
  }
  const variantId = String(variantIdRaw);
  const plan = findPlanByVariantId(variantId);
  if (!plan) {
    logger.info('order_created variant_id not in catalog — acked, no-op', {
      variant_id: variantId,
    });
    return;
  }
  if (plan.planCode !== 'pro_lifetime') {
    // Recurring orders also hit order_created — subscription_* path owns that flow.
    logger.info('order_created for recurring plan — handled by subscription_* path', {
      plan_code: plan.planCode,
    });
    return;
  }
  await applyLifetimeOrder({
    userId,
    providerOrderId: event.data.id,
    providerCustomerId:
      event.data.attributes.customer_id != null ? String(event.data.attributes.customer_id) : null,
    variantId,
    amountCents: event.data.attributes.total ?? 0,
    currency: event.data.attributes.currency ?? 'USD',
  });
}

function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const code = (err as { code?: string }).code;
  return code === 'P2002'; // Prisma unique constraint violation
}
