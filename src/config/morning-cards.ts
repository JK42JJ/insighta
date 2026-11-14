/**
 * Mobile morning cards (PRD #1788). stg-only; unset = off (no-op).
 * Non-secret settings: flag + comma-separated test account user ids.
 */
import { z } from 'zod';

const flagFromEnv = z.preprocess((v) => {
  if (v == null) return false;
  const s = String(v).trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}, z.boolean());

const idListFromEnv = z.preprocess((v) => {
  if (v == null) return [];
  return String(v)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}, z.array(z.string()));

export const morningCardsEnvSchema = z.object({
  MOBILE_MORNING_CARDS: flagFromEnv,
  MORNING_CARDS_TEST_USER_IDS: idListFromEnv,
  /** stg only (chart staging values): accounts that may set a virtual "today" for repeat tests. */
  MORNING_VIRTUAL_DAY_USER_IDS: idListFromEnv,
});

export interface MorningCardsConfig {
  enabled: boolean;
  testUserIds: readonly string[];
  virtualDayUserIds: readonly string[];
}

export function getMorningCardsConfig(env: NodeJS.ProcessEnv = process.env): MorningCardsConfig {
  const parsed = morningCardsEnvSchema.parse({
    MOBILE_MORNING_CARDS: env['MOBILE_MORNING_CARDS'],
    MORNING_CARDS_TEST_USER_IDS: env['MORNING_CARDS_TEST_USER_IDS'],
    MORNING_VIRTUAL_DAY_USER_IDS: env['MORNING_VIRTUAL_DAY_USER_IDS'],
  });
  return {
    enabled: parsed.MOBILE_MORNING_CARDS,
    testUserIds: parsed.MORNING_CARDS_TEST_USER_IDS,
    virtualDayUserIds: parsed.MORNING_VIRTUAL_DAY_USER_IDS,
  };
}

/**
 * Virtual today (decision 2026-11-14): only with the morning cards flag on, for a test user that
 * is also on the virtual-day list. The list is set in the staging chart only, so prod never has it.
 */
export function isVirtualDayUser(
  userId: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (!userId) return false;
  const cfg = getMorningCardsConfig(env);
  return cfg.enabled && cfg.testUserIds.includes(userId) && cfg.virtualDayUserIds.includes(userId);
}

export function isMorningCardsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return getMorningCardsConfig(env).enabled;
}

/** True only when the flag is on AND the user id is on the allowlist. */
export function isMorningCardsTestUser(
  userId: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (!userId) return false;
  const cfg = getMorningCardsConfig(env);
  return cfg.enabled && cfg.testUserIds.includes(userId);
}
