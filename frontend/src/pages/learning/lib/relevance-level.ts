/**
 * Relevance tier mapping for the video-view chapter UI (mockup spec).
 * high >= 80 aligns with HIGHLIGHT_RELEVANCE_THRESHOLD (useHighlightReel).
 */

export type RelevanceLevel = 'high' | 'mid' | 'low';

export const RELEVANCE_HIGH_MIN = 80;
export const RELEVANCE_MID_MIN = 50;

export function relevanceLevel(pct: number): RelevanceLevel {
  if (pct >= RELEVANCE_HIGH_MIN) return 'high';
  if (pct >= RELEVANCE_MID_MIN) return 'mid';
  return 'low';
}

/** CSS var name per level — tokens defined under `.note-mode` in index.css. */
export function relevanceCssVar(level: RelevanceLevel): string {
  return `var(--lp-rel-${level})`;
}

/** Meter bar count lit per level (3-bar ascending signal meter). */
export function relevanceBars(level: RelevanceLevel): number {
  return level === 'high' ? 3 : level === 'mid' ? 2 : 1;
}
