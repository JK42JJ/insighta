/**
 * Depth scale → 3 buckets aligned with the mandala target levels.
 *
 * Existing depth vocabularies in the codebase:
 *   - v2 rich summary core.depth_level: 'beginner' | 'intermediate' | 'advanced'
 *     (src/modules/skills/rich-summary-v2-prompt.ts DepthLevel)
 *   - video_pool.depth_level (varchar 15): 'beginner' | 'intermediate' | 'advanced' | 'mixed' | NULL
 *     (prisma/schema.prisma, video_pool model comment)
 *   - user_mandalas.target_level: TARGET_LEVELS 'foundation' | 'standard' | 'advanced'
 *     plus LEGACY_TARGET_LEVELS 'beginner' | 'intermediate' | 'expert'
 *
 * Mapping (same as keyword-builder's TARGET_LEVEL_KEYWORDS: foundation ≙ beginner):
 *   beginner, foundation        → foundation
 *   intermediate, standard      → standard
 *   advanced, expert            → advanced
 *   mixed, NULL, anything else  → null (unknown → neutral level fit)
 */

import { DEFAULT_TARGET_LEVEL, TARGET_LEVELS, isTargetLevel } from '@/modules/mandala/target-level';
import type { TargetLevel } from '@/modules/mandala/target-level';

import type { DepthBucket, DepthPref } from './types';

const DEPTH_TO_BUCKET: Readonly<Record<string, DepthBucket>> = Object.freeze({
  beginner: 'foundation',
  foundation: 'foundation',
  intermediate: 'standard',
  standard: 'standard',
  advanced: 'advanced',
  expert: 'advanced',
});

export const DEPTH_BUCKETS: readonly DepthBucket[] = TARGET_LEVELS;

export function toDepthBucket(raw: string | null | undefined): DepthBucket | null {
  if (typeof raw !== 'string') return null;
  const key = raw.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(DEPTH_TO_BUCKET, key)
    ? (DEPTH_TO_BUCKET[key] ?? null)
    : null;
}

/** Declared level of a context; legacy values are mapped, unknown → DEFAULT_TARGET_LEVEL. */
export function toDeclaredLevel(raw: unknown): TargetLevel {
  if (isTargetLevel(raw)) return raw;
  return toDepthBucket(typeof raw === 'string' ? raw : null) ?? DEFAULT_TARGET_LEVEL;
}

export function emptyDepthPref(): DepthPref {
  return {
    foundation: { likes: 0, dislikes: 0 },
    standard: { likes: 0, dislikes: 0 },
    advanced: { likes: 0, dislikes: 0 },
  };
}
