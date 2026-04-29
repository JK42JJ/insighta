/**
 * Shared types for the Mac Mini video-collector (CP438).
 *
 * Each source returns a list of YouTube video IDs (or VideoMeta rows when
 * the source supplies metadata directly). The orchestrator dedupes,
 * enriches via YouTube Data API, and POSTs to /internal/videos/bulk-upsert.
 */

export interface VideoMeta {
  youtube_video_id: string;
  title?: string;
  channel_title?: string | null;
  duration_seconds?: number | null;
  view_count?: number | null;
  like_count?: number | null;
  thumbnail_url?: string | null;
  published_at?: string | null;
  default_language?: string | null;
}

export interface SourceResult {
  source: 'ytdlp_trending' | 'naver_datalab' | 'google_trends' | 'youtube_mostpopular' | 'domain_keywords';
  region?: 'KR' | 'US' | 'global';
  /** Already-enriched rows (from sources that return metadata directly). */
  videos: VideoMeta[];
  /** Bare IDs (orchestrator enriches via YouTube Data API). */
  videoIdsOnly: string[];
  /** Per-source diagnostic — keyword/category/error count. */
  diagnostics: Record<string, unknown>;
}
