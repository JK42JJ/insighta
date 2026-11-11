/**
 * Mandala target level — canonical values.
 *
 * Single source of truth for the values stored in
 * `user_mandalas.target_level`. The wizard (frontend
 * `WizardStepContext.tsx` TARGET_LEVELS) sends exactly these three; the
 * column default is `'standard'` (prisma/schema.prisma).
 *
 * `LEGACY_TARGET_LEVELS` are values the rule-based keyword map accepted
 * before the wizard vocabulary was settled. They are kept readable so rows
 * written with them keep their previous search behaviour.
 *
 * Pure module (no imports) so scripts and prompt builders can depend on it
 * without loading config.
 */

export const TARGET_LEVELS = ['foundation', 'standard', 'advanced'] as const;

export type TargetLevel = (typeof TARGET_LEVELS)[number];

export const DEFAULT_TARGET_LEVEL: TargetLevel = 'standard';

export const LEGACY_TARGET_LEVELS = ['beginner', 'intermediate', 'expert'] as const;

export type LegacyTargetLevel = (typeof LEGACY_TARGET_LEVELS)[number];
