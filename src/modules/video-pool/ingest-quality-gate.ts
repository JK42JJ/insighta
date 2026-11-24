/**
 * Ingest quality gate (CP438 spec §2) — pure, shared by the internal
 * videos bulk-upsert route and the card-experiment replay module.
 * Extracted verbatim from api/routes/internal/videos-bulk-upsert.ts.
 */

/** Quality gate constants (CP438 spec §2 품질 게이트). */
export const DURATION_MIN_SEC = 180;
export const DURATION_MAX_SEC = 3600;
export const TITLE_MIN_LEN = 5;

/**
 * Title blocklist — drop entries whose title contains any of these
 * substrings (case-insensitive). Per CP438 spec: 광고/PPL/협찬/sponsored
 * /드라마/팬편집. Kept as a single set so future tuning lives in one place.
 */
export const BLOCKLIST_TOKENS: readonly string[] = [
  '광고',
  'ppl',
  '협찬',
  'sponsored',
  '드라마',
  '팬편집',
];

export interface VideoMeta {
  youtube_video_id?: string;
  title?: string;
  /** CP494 ② — full description from videos.list snippet. */
  description?: string | null;
  /** CP494 ② — UC* channel id (snippet.channelId). */
  channel_id?: string | null;
  channel_title?: string | null;
  duration_seconds?: number | null;
  view_count?: number | null;
  like_count?: number | null;
  thumbnail_url?: string | null;
  published_at?: string | null;
  default_language?: string | null;
  /** CP438 collector pipeline source (column added 2026-04-29). */
  source?: string | null;
}

/** Whitelist of allowed values for `source` per CP438 spec. */
const ALLOWED_SOURCES: ReadonlySet<string> = new Set([
  'category_mostpopular',
  'naver_keyword',
  'youtube_mostpopular',
  'domain_keyword',
]);

function normalizeSource(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  const trimmed = s.trim();
  return ALLOWED_SOURCES.has(trimmed) ? trimmed : null;
}

export interface FilterResult {
  pass: VideoMeta[];
  filtered: { id: string; reason: string }[];
}

export function applyQualityGate(videos: VideoMeta[]): FilterResult {
  const pass: VideoMeta[] = [];
  const filtered: { id: string; reason: string }[] = [];
  const seen = new Set<string>();

  for (const v of videos) {
    const id = typeof v.youtube_video_id === 'string' ? v.youtube_video_id.trim() : '';
    const title = typeof v.title === 'string' ? v.title.trim() : '';

    if (!id) {
      filtered.push({ id: '<missing>', reason: 'no_video_id' });
      continue;
    }
    if (seen.has(id)) {
      filtered.push({ id, reason: 'duplicate_in_batch' });
      continue;
    }
    seen.add(id);

    if (title.length < TITLE_MIN_LEN) {
      filtered.push({ id, reason: 'title_too_short' });
      continue;
    }
    const titleLower = title.toLowerCase();
    const blocked = BLOCKLIST_TOKENS.find((t) => titleLower.includes(t));
    if (blocked) {
      filtered.push({ id, reason: `blocklist:${blocked}` });
      continue;
    }
    if (typeof v.duration_seconds === 'number') {
      if (v.duration_seconds < DURATION_MIN_SEC) {
        filtered.push({ id, reason: 'too_short' });
        continue;
      }
      if (v.duration_seconds > DURATION_MAX_SEC) {
        filtered.push({ id, reason: 'too_long' });
        continue;
      }
    }
    pass.push({
      ...v,
      youtube_video_id: id,
      title,
      source: normalizeSource(v.source),
    });
  }
  return { pass, filtered };
}
