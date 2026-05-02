-- CP438+1 (2026-05-03): transcript_attempted_at column for stale-no_caption skip.
-- Stamped by mac-mini/v2-author/process-one.sh on no_caption / claude_invalid_json
-- exit paths so the candidates selector can exclude recently-attempted videos
-- and avoid the resurfacing loop documented in docs/runbook/cp438-resume-handoff.md §4.
--
-- Apply order:
--   1. Local: psql "$DATABASE_URL" -f prisma/migrations/transcript-attempted/001_add_column.sql
--   2. Local: prisma db push --skip-generate (sync with Prisma)
--   3. Local: psql "$DATABASE_URL" -c "NOTIFY pgrst, 'reload schema'"
--   4. Local: docker restart supabase-rest-dev   # if local Supabase is up
--   5. Prod: deploy.yml CI runs prisma db push (LEVEL-3 silent-fail risk!)
--   6. Prod: ssh + docker exec psql apply this raw DDL too (defensive)
--   7. Prod: Supabase Dashboard → Settings → API → "Reload schema"

ALTER TABLE youtube_videos
  ADD COLUMN IF NOT EXISTS transcript_attempted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_youtube_videos_transcript_attempted_at
  ON youtube_videos(transcript_attempted_at);

-- Postgrest schema cache reload (no-op if not on local PostgREST)
NOTIFY pgrst, 'reload schema';
