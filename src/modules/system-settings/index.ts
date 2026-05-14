/**
 * system_settings — generic key-value runtime config (CP456 Phase 5).
 *
 * Backed by `public.system_settings` (key text PK, value jsonb).
 * In-memory cache (TTL 30s) so hot-path reads (e.g., every checkout request)
 * don't hit the DB. `setSetting` invalidates the cache key immediately so
 * admin toggles propagate within ~30s + the in-process invalidation.
 *
 * Type contract: callers pass a runtime-typed `T` matching the stored JSON
 * shape. The module itself doesn't validate — keep flag values primitive
 * (boolean / string / number) to avoid drift.
 */

import { db } from '@/modules/database/client';

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { value: unknown; expiresAt: number }>();

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value as T;
  }
  const row = await db.system_settings.findUnique({ where: { key } });
  const value = (row?.value as T | undefined) ?? fallback;
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

export async function setSetting(key: string, value: unknown, updatedBy?: string): Promise<void> {
  await db.system_settings.upsert({
    where: { key },
    create: {
      key,
      value: value as object,
      ...(updatedBy ? { updated_by: updatedBy } : {}),
    },
    update: {
      value: value as object,
      ...(updatedBy ? { updated_by: updatedBy } : {}),
      updated_at: new Date(),
    },
  });
  cache.delete(key);
}

export function invalidateCache(key?: string): void {
  if (key) cache.delete(key);
  else cache.clear();
}

// Well-known keys — centralize to avoid string typos at call sites.
export const SETTING_KEYS = {
  BILLING_ENABLED: 'billing_enabled',
  /**
   * trend-collector LLM extraction model id (OpenRouter path).
   * Stored value example: "anthropic/claude-haiku-4.5".
   * Read by `src/skills/plugins/trend-collector/sources/llm-extract.ts`.
   * Admin can override via PUT /api/v1/admin/settings/trend_extract_model.
   */
  TREND_EXTRACT_MODEL: 'trend_extract_model',
} as const;
