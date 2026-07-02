-- Global search (⌘K) Phase 1 — trigram indexes for ILIKE substring search.
-- Idempotent: safe to re-run (IF NOT EXISTS everywhere).
-- Measured need (2026-07-02, prod, worst-case term): cards group 927ms,
-- summaries group 1688ms on seq scans — GIN trgm brings both to ms range.
-- Design: docs/design/global-search-cmdk-2026-07-02.md §3.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- cards group: user_video_states JOIN youtube_videos(title, channel_title)
CREATE INDEX IF NOT EXISTS idx_yv_title_trgm
  ON youtube_videos USING gin (title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_yv_channel_title_trgm
  ON youtube_videos USING gin (channel_title gin_trgm_ops);

-- summaries group: video_rich_summaries.one_liner (Phase 1 = one_liner only)
CREATE INDEX IF NOT EXISTS idx_vrs_one_liner_trgm
  ON video_rich_summaries USING gin (one_liner gin_trgm_ops);
