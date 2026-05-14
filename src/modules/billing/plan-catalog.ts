/**
 * Plan catalog — maps LS variant_id ↔ internal plan_code ↔ tier.
 * MVP scope (ADR-10): pro_monthly only @ $9.99 USD/month.
 *
 * variant_id source: process.env.LEMONSQUEEZY_VARIANT_ID_PRO_MONTHLY (per-env).
 * Adding a new plan = (1) add env var, (2) extend catalog array, (3) update plan_code/tier union in types.ts.
 */

import { billingConfig } from './config';
import { TIER_LIMITS } from '@/config/quota';
import type { PlanCatalogEntry } from './types';

/**
 * Resolve a variant_id (from LS webhook or checkout request) to its catalog entry.
 * Returns null when the variant_id is not registered for this environment.
 */
export function findPlanByVariantId(variantId: string): PlanCatalogEntry | null {
  for (const entry of getCatalog()) {
    if (entry.variantId === variantId) return entry;
  }
  return null;
}

export function findPlanByCode(planCode: string): PlanCatalogEntry | null {
  for (const entry of getCatalog()) {
    if (entry.planCode === planCode) return entry;
  }
  return null;
}

export function getCatalog(): PlanCatalogEntry[] {
  const proLimits = TIER_LIMITS.pro;
  const proCardLimit = proLimits.cards ?? Number.POSITIVE_INFINITY;
  const proMandalaLimit = proLimits.mandalas ?? Number.POSITIVE_INFINITY;
  const entries: PlanCatalogEntry[] = [];

  if (billingConfig.variants.proMonthly) {
    entries.push({
      variantId: billingConfig.variants.proMonthly,
      planCode: 'pro_monthly',
      tier: 'pro',
      cardLimit: proCardLimit,
      mandalaLimit: proMandalaLimit,
    });
  }
  if (billingConfig.variants.proYearly) {
    entries.push({
      variantId: billingConfig.variants.proYearly,
      planCode: 'pro_yearly',
      tier: 'pro',
      cardLimit: proCardLimit,
      mandalaLimit: proMandalaLimit,
    });
  }
  if (billingConfig.variants.lifetime) {
    const lifetimeLimits = TIER_LIMITS.lifetime;
    entries.push({
      variantId: billingConfig.variants.lifetime,
      planCode: 'pro_lifetime',
      tier: 'lifetime',
      cardLimit: lifetimeLimits.cards ?? Number.POSITIVE_INFINITY,
      mandalaLimit: lifetimeLimits.mandalas ?? Number.POSITIVE_INFINITY,
    });
  }
  return entries;
}
