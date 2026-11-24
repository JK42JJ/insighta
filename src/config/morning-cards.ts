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
  /** Shared brief (2026-11-14): the one account whose morning_pages rows every signed-in user reads. Unset = own rows. */
  MORNING_BRIEF_OWNER_ID: z.preprocess((v) => {
    if (v == null) return null;
    const s = String(v).trim();
    return s === '' ? null : s;
  }, z.string().uuid().nullable()),
  /** Accounts that keep the experiment UI (video batches, viewing order). Also needs the test list. */
  MORNING_EXPERIMENT_USER_IDS: idListFromEnv,
});

export interface MorningCardsConfig {
  enabled: boolean;
  testUserIds: readonly string[];
  virtualDayUserIds: readonly string[];
  /** Account whose pages everyone reads; null = each user reads their own. */
  briefOwnerId: string | null;
  experimentUserIds: readonly string[];
}

export function getMorningCardsConfig(env: NodeJS.ProcessEnv = process.env): MorningCardsConfig {
  const parsed = morningCardsEnvSchema.parse({
    MOBILE_MORNING_CARDS: env['MOBILE_MORNING_CARDS'],
    MORNING_CARDS_TEST_USER_IDS: env['MORNING_CARDS_TEST_USER_IDS'],
    MORNING_VIRTUAL_DAY_USER_IDS: env['MORNING_VIRTUAL_DAY_USER_IDS'],
    MORNING_BRIEF_OWNER_ID: env['MORNING_BRIEF_OWNER_ID'],
    MORNING_EXPERIMENT_USER_IDS: env['MORNING_EXPERIMENT_USER_IDS'],
  });
  return {
    enabled: parsed.MOBILE_MORNING_CARDS,
    testUserIds: parsed.MORNING_CARDS_TEST_USER_IDS,
    virtualDayUserIds: parsed.MORNING_VIRTUAL_DAY_USER_IDS,
    briefOwnerId: parsed.MORNING_BRIEF_OWNER_ID,
    experimentUserIds: parsed.MORNING_EXPERIMENT_USER_IDS,
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

/** Flag on AND a signed-in user (any account): may read the shared brief and send feedback/usage events. */
export function isBriefReader(
  userId: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (!userId) return false;
  return getMorningCardsConfig(env).enabled;
}

/** Flag on AND on the test list AND on the experiment list: keeps the experiment UI. */
export function isExperimentUser(
  userId: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (!userId) return false;
  const cfg = getMorningCardsConfig(env);
  return cfg.enabled && cfg.testUserIds.includes(userId) && cfg.experimentUserIds.includes(userId);
}

/** Whose morning_pages rows `viewerId` reads: the shared owner when set, else the viewer. */
export function briefOwnerFor(viewerId: string, env: NodeJS.ProcessEnv = process.env): string {
  return getMorningCardsConfig(env).briefOwnerId ?? viewerId;
}
