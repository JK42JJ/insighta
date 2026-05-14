/**
 * Lemon Squeezy billing — module config (zod schema).
 *
 * CLAUDE.md "Configuration Architecture: Secrets vs Config" 준수:
 * - LEMONSQUEEZY_API_KEY / WEBHOOK_SECRET = 명백한 secret (GitHub Secrets).
 * - LEMONSQUEEZY_STORE_ID / VARIANT_ID_PRO_MONTHLY = 환경별 분리용 (Secret 등록 유지, drift 회피).
 *
 * Unset → routes return 503 (graceful disable, ADR-1/§7.1 rollback pattern).
 */

import { z } from 'zod';

const envSchema = z.object({
  LEMONSQUEEZY_API_KEY: z.string().min(1).optional(),
  LEMONSQUEEZY_WEBHOOK_SECRET: z.string().min(1).optional(),
  LEMONSQUEEZY_STORE_ID: z.string().min(1).optional(),
  LEMONSQUEEZY_VARIANT_ID_PRO_MONTHLY: z.string().min(1).optional(),
  LEMONSQUEEZY_VARIANT_ID_PRO_YEARLY: z.string().min(1).optional(),
  LEMONSQUEEZY_VARIANT_ID_PRO_LIFETIME: z.string().min(1).optional(),
});

export type BillingEnv = z.infer<typeof envSchema>;

export interface BillingConfig {
  apiKey: string;
  webhookSecret: string;
  storeId: string;
  variants: {
    proMonthly: string;
    proYearly: string;
    /** One-time order variant for Pioneer Lifetime. Empty string when not configured. */
    lifetime: string;
  };
  /** Whether the core (monthly) configuration is complete. Routes guard on this. */
  enabled: boolean;
}

/**
 * Parse + freeze billing config from process.env at module load.
 * Returns `enabled=false` when any required env is missing (no throw).
 */
export function loadBillingConfig(env: NodeJS.ProcessEnv = process.env): BillingConfig {
  const parsed = envSchema.safeParse({
    LEMONSQUEEZY_API_KEY: env['LEMONSQUEEZY_API_KEY'],
    LEMONSQUEEZY_WEBHOOK_SECRET: env['LEMONSQUEEZY_WEBHOOK_SECRET'],
    LEMONSQUEEZY_STORE_ID: env['LEMONSQUEEZY_STORE_ID'],
    LEMONSQUEEZY_VARIANT_ID_PRO_MONTHLY: env['LEMONSQUEEZY_VARIANT_ID_PRO_MONTHLY'],
    LEMONSQUEEZY_VARIANT_ID_PRO_YEARLY: env['LEMONSQUEEZY_VARIANT_ID_PRO_YEARLY'],
    LEMONSQUEEZY_VARIANT_ID_PRO_LIFETIME: env['LEMONSQUEEZY_VARIANT_ID_PRO_LIFETIME'],
  });

  if (!parsed.success) {
    return emptyConfig();
  }

  const e = parsed.data;
  const allSet =
    !!e.LEMONSQUEEZY_API_KEY &&
    !!e.LEMONSQUEEZY_WEBHOOK_SECRET &&
    !!e.LEMONSQUEEZY_STORE_ID &&
    !!e.LEMONSQUEEZY_VARIANT_ID_PRO_MONTHLY &&
    !!e.LEMONSQUEEZY_VARIANT_ID_PRO_YEARLY;

  if (!allSet) {
    return emptyConfig();
  }

  return {
    apiKey: e.LEMONSQUEEZY_API_KEY!,
    webhookSecret: e.LEMONSQUEEZY_WEBHOOK_SECRET!,
    storeId: e.LEMONSQUEEZY_STORE_ID!,
    variants: {
      proMonthly: e.LEMONSQUEEZY_VARIANT_ID_PRO_MONTHLY!,
      proYearly: e.LEMONSQUEEZY_VARIANT_ID_PRO_YEARLY!,
      lifetime: e.LEMONSQUEEZY_VARIANT_ID_PRO_LIFETIME ?? '',
    },
    enabled: true,
  };
}

function emptyConfig(): BillingConfig {
  return {
    apiKey: '',
    webhookSecret: '',
    storeId: '',
    variants: { proMonthly: '', proYearly: '', lifetime: '' },
    enabled: false,
  };
}

export const billingConfig = loadBillingConfig();
