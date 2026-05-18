/**
 * Shared numeric formatters. Single source of truth so any future
 * tweak (locale-aware separators, abbreviation thresholds) propagates
 * to every consumer that imports from here.
 */

const VIEW_COUNT_BILLION = 1_000_000_000;
const VIEW_COUNT_MILLION = 1_000_000;
const VIEW_COUNT_THOUSAND = 1_000;

/** YouTube-style abbreviated view count. Returns null for null|<=0. */
export function formatViewCount(count: number | null | undefined): string | null {
  if (count == null || count <= 0) return null;
  if (count >= VIEW_COUNT_BILLION) return `${(count / VIEW_COUNT_BILLION).toFixed(1)}B`;
  if (count >= VIEW_COUNT_MILLION) return `${(count / VIEW_COUNT_MILLION).toFixed(1)}M`;
  if (count >= VIEW_COUNT_THOUSAND) return `${(count / VIEW_COUNT_THOUSAND).toFixed(1)}K`;
  return String(count);
}

/** YouTube-style duration `H:MM:SS` / `M:SS`. Returns null for null|<=0. */
export function formatDuration(seconds: number | null | undefined): string | null {
  if (seconds == null || seconds <= 0) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
