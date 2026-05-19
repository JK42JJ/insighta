-- CP474 — expand youtube_videos with 14 missing fields from videos.list
-- (snippet / contentDetails / status parts). Companion to PR #670 which
-- activated the dormant metadata cron; new columns are additive so
-- existing metadata_fetched_at rows do NOT need reset.
--
-- Hard Rule LEVEL-3 "prisma db push silent fail" — apply via psql /
-- apply-custom-sql.sh, never `prisma db push` alone. ADD COLUMN IF NOT
-- EXISTS makes re-application a no-op on every deploy.

BEGIN;

ALTER TABLE public.youtube_videos
  ADD COLUMN IF NOT EXISTS category_id            varchar(5),
  ADD COLUMN IF NOT EXISTS channel_id             varchar(30),
  ADD COLUMN IF NOT EXISTS default_audio_language varchar(10),
  ADD COLUMN IF NOT EXISTS live_broadcast_content varchar(10),
  ADD COLUMN IF NOT EXISTS localized_title        text,
  ADD COLUMN IF NOT EXISTS localized_description  text,
  ADD COLUMN IF NOT EXISTS thumbnails             jsonb,
  ADD COLUMN IF NOT EXISTS dimension              varchar(5),
  ADD COLUMN IF NOT EXISTS definition             varchar(5),
  ADD COLUMN IF NOT EXISTS licensed_content       boolean,
  ADD COLUMN IF NOT EXISTS projection             varchar(20),
  ADD COLUMN IF NOT EXISTS region_restriction     jsonb,
  ADD COLUMN IF NOT EXISTS upload_status          varchar(20),
  ADD COLUMN IF NOT EXISTS privacy_status         varchar(20);

COMMENT ON COLUMN public.youtube_videos.category_id IS
  'CP474 — YouTube snippet.categoryId (Education/Howto/etc numeric ID).';
COMMENT ON COLUMN public.youtube_videos.channel_id IS
  'CP474 — YouTube snippet.channelId. channel_title was previously the only channel identifier.';
COMMENT ON COLUMN public.youtube_videos.thumbnails IS
  'CP474 — jsonb of {medium, high, standard, maxres}.url. thumbnail_url remains the default (high) for back-compat.';
COMMENT ON COLUMN public.youtube_videos.region_restriction IS
  'CP474 — contentDetails.regionRestriction { allowed: [], blocked: [] }. Null when no restriction.';

COMMIT;

-- Validation:
--   psql "$DIRECT_URL" -c "\d public.youtube_videos" | grep -E 'category_id|channel_id|thumbnails|dimension|licensed_content|upload_status'
--
-- Rollback (dev only):
--   ALTER TABLE public.youtube_videos
--     DROP COLUMN IF EXISTS category_id, DROP COLUMN IF EXISTS channel_id,
--     DROP COLUMN IF EXISTS default_audio_language, DROP COLUMN IF EXISTS live_broadcast_content,
--     DROP COLUMN IF EXISTS localized_title, DROP COLUMN IF EXISTS localized_description,
--     DROP COLUMN IF EXISTS thumbnails, DROP COLUMN IF EXISTS dimension,
--     DROP COLUMN IF EXISTS definition, DROP COLUMN IF EXISTS licensed_content,
--     DROP COLUMN IF EXISTS projection, DROP COLUMN IF EXISTS region_restriction,
--     DROP COLUMN IF EXISTS upload_status, DROP COLUMN IF EXISTS privacy_status;
