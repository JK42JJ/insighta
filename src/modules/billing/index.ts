/**
 * Lemon Squeezy billing — module barrel.
 * Routes import from this file; submodule internals are not re-exported.
 */

export { billingConfig, loadBillingConfig } from './config';
export type { BillingConfig } from './config';

export { verifyLemonSqueezySignature } from './webhook-verifier';
export type { VerifyResult } from './webhook-verifier';

export {
  createCheckout,
  getCustomer,
  findActiveSubscriptionByEmail,
  LemonSqueezyApiError,
} from './lemonsqueezy-client';
export type {
  CreateCheckoutInput,
  CreateCheckoutResponse,
  CustomerResponse,
  ActiveSubscriptionSummary,
} from './lemonsqueezy-client';

export { handleEvent, mapStatus } from './webhook-handler';
export type { HandleEventInput, HandleEventResult } from './webhook-handler';

export {
  upsertSubscription,
  applyLifetimeOrder,
  findActiveSubscriptionByUser,
} from './subscription-service';

export { findPlanByVariantId, findPlanByCode, getCatalog } from './plan-catalog';

export { BILLING_PROVIDER, BILLING_SUBSCRIPTION_STATUSES, PLAN_CODES } from './types';
export type {
  BillingProvider,
  BillingSubscriptionStatus,
  PlanCode,
  PlanTier,
  PlanCatalogEntry,
  LemonSqueezyWebhookEvent,
  LSSubscriptionAttributes,
  LSOrderAttributes,
  SubscriptionUpsertInput,
} from './types';
