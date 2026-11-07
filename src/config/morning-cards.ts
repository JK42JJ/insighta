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
});

export interface MorningCardsConfig {
  enabled: boolean;
  testUserIds: readonly string[];
}

export function getMorningCardsConfig(env: NodeJS.ProcessEnv = process.env): MorningCardsConfig {
  const parsed = morningCardsEnvSchema.parse({
    MOBILE_MORNING_CARDS: env['MOBILE_MORNING_CARDS'],
    MORNING_CARDS_TEST_USER_IDS: env['MORNING_CARDS_TEST_USER_IDS'],
  });
  return { enabled: parsed.MOBILE_MORNING_CARDS, testUserIds: parsed.MORNING_CARDS_TEST_USER_IDS };
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
