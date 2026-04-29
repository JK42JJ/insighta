-- CP437 (2026-04-29) — youtube_videos full metadata expansion
--
-- Adds 6 new columns to capture the full set of fields returned by
-- youtube videos.list (parts=snippet,contentDetails,statistics,topicDetails).
-- `like_count` already exists in the table — included here as IF NOT EXISTS
-- for idempotency only.
--
-- Backfill is driven by the prod-runtime cron in
-- src/modules/scheduler/youtube-metadata-cron.ts. Default OFF
-- (YOUTUBE_METADATA_BACKFILL_ENABLED) — operator must explicitly flip after
-- design review.
--
-- IMPORTANT (CLAUDE.md "prisma db push silent fail" Hard Rule):
--   Apply via psql, NOT `prisma db push`. After apply, verify with:
--     SELECT column_name FROM information_schema.columns
--     WHERE table_schema='public' AND table_name='youtube_videos'
--       AND column_name IN ('comment_count','tags','topic_categories',
--                            'has_caption','default_language','metadata_fetched_at');

ALTER TABLE youtube_videos
  ADD COLUMN IF NOT EXISTS like_count            BIGINT,
  ADD COLUMN IF NOT EXISTS comment_count         BIGINT,
  ADD COLUMN IF NOT EXISTS tags                  TEXT[],
  ADD COLUMN IF NOT EXISTS topic_categories      TEXT[],
  ADD COLUMN IF NOT EXISTS has_caption           BOOLEAN,
  ADD COLUMN IF NOT EXISTS default_language      VARCHAR(10),
  ADD COLUMN IF NOT EXISTS metadata_fetched_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS transcript_fetched_at TIMESTAMPTZ;
-- transcript_fetched_at: stamped by the Mac Mini transcript pipeline
-- AFTER yt-dlp pull + v2 summary generation succeeds. The transcript
-- text itself is never stored (memory-only on Mac Mini, immediately
-- discarded post-summary per legal directive 2026-04-29). This column
-- is the only persisted record that a transcript was ever fetched.

-- Index on metadata_fetched_at to make the backfill candidate selector
-- (`WHERE metadata_fetched_at IS NULL ORDER BY ...`) cheap on 5,874 rows.
CREATE INDEX IF NOT EXISTS idx_youtube_videos_metadata_fetched_at
  ON youtube_videos (metadata_fetched_at);

-- Same idea for the transcript candidate selector.
CREATE INDEX IF NOT EXISTS idx_youtube_videos_transcript_fetched_at
  ON youtube_videos (transcript_fetched_at);
