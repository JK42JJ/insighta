-- CP438 (2026-04-29) — collector source tagging.
--
-- Adds youtube_videos.source so we can attribute each row to one of the
-- 4 collector pipeline sources. Existing rows stay NULL (소급 불가 per
-- CP438 plan). Going forward the bulk-upsert endpoint accepts a source
-- field and stamps it on insert; ON CONFLICT DO UPDATE rewrites source
-- on subsequent submissions so a video re-discovered via a different
-- source path keeps the most-recent attribution.
--
-- Allowed values (informational — column is plain VARCHAR(30) with no
-- DB CHECK constraint so future sources can be added without migration):
--   'category_mostpopular'  — Source 1 (videoCategoryId × KR/US)
--   'naver_keyword'         — Source 2 (Naver DataLab + yt-dlp search)
--   'youtube_mostpopular'   — Source 3 (chart=mostPopular generic)
--   'domain_keyword'        — Source 4 (9-domain × 10 templates)

ALTER TABLE youtube_videos
  ADD COLUMN IF NOT EXISTS source VARCHAR(30);

CREATE INDEX IF NOT EXISTS idx_youtube_videos_source
  ON youtube_videos (source)
  WHERE source IS NOT NULL;

COMMENT ON COLUMN youtube_videos.source IS
  'CP438 collector pipeline source: category_mostpopular / naver_keyword / youtube_mostpopular / domain_keyword. NULL = pre-CP438 legacy row.';

-- Postgrest schema reload (Supabase) — required so the new column is
-- visible to PostgREST/REST clients. CP383 hard rule §ALTER 직후 reload.
NOTIFY pgrst, 'reload schema';
