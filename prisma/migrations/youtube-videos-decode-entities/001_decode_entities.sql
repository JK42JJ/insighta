-- =========================================================================
-- DB-level HTML entity decode for youtube_videos.title + channel_title
--
-- Background: YouTube Data API v3 returns `snippet.title` /
-- `snippet.channelTitle` with HTML entities ESCAPED (`&quot;`, `&#39;`,
-- `&amp;`, `&lt;`, etc.). FE/BE write paths store the raw entity-escaped
-- form, so any FE render position that doesn't explicitly call
-- `decodeHtmlEntities` displays raw `&quot;` / `&#39;` to the user (CP489
-- user-report: image #51 MandalaCell tooltip, image #52 AddCardsList).
--
-- Strategy: handle the decode at the DB boundary so every consumer
-- (FE/BE/EF/chatbot/share/export) receives clean text without per-callsite
-- decode discipline. Idempotent — re-running on already-decoded rows is a
-- no-op.
--
-- Components:
--   1. `public.decode_html_entities(text)` — pure SQL function, idempotent.
--   2. `public.decode_youtube_videos_titles()` — BEFORE INSERT/UPDATE
--      trigger that auto-decodes the two columns on every write.
--   3. One-shot backfill of existing rows that still carry entity markup.
--
-- Apply (local):
--   docker exec -i supabase-db-dev psql -U postgres -d postgres \
--     -f prisma/migrations/youtube-videos-decode-entities/001_decode_entities.sql
--
-- Apply (prod): handled by CI/CD deploy.yml schema-sync. CREATE OR REPLACE
-- everywhere — safe to re-apply.
-- =========================================================================

-- ---------- 1. Pure decode function ----------
CREATE OR REPLACE FUNCTION public.decode_html_entities(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  -- Covers the 8 entities YouTube actually produces in snippet.title /
  -- channelTitle. Mirror of frontend/src/shared/lib/decode-html-entities.ts
  -- (CP468 origin) for parity.
  -- IMPORTANT: '&amp;' must run LAST so we don't double-decode entities
  -- like '&amp;quot;' → '&quot;' → '"' (good) without corrupting a literal
  -- '&amp;' that should become a single '&'.
  SELECT CASE
    WHEN input IS NULL THEN NULL
    ELSE replace(replace(replace(replace(replace(replace(replace(replace(
      input,
      '&quot;', '"'),
      '&#39;',  ''''),
      '&apos;', ''''),
      '&#x27;', ''''),
      '&lt;',   '<'),
      '&gt;',   '>'),
      '&nbsp;', ' '),
      '&amp;',  '&')
  END;
$$;

-- ---------- 2. BEFORE INSERT/UPDATE trigger on youtube_videos ----------
CREATE OR REPLACE FUNCTION public.decode_youtube_videos_titles()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.title := public.decode_html_entities(NEW.title);
  NEW.channel_title := public.decode_html_entities(NEW.channel_title);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_decode_youtube_videos_titles ON public.youtube_videos;

CREATE TRIGGER trg_decode_youtube_videos_titles
  BEFORE INSERT OR UPDATE ON public.youtube_videos
  FOR EACH ROW
  EXECUTE FUNCTION public.decode_youtube_videos_titles();

-- ---------- 3. One-shot backfill of existing rows ----------
-- Only touch rows that still carry entity markup — bounded UPDATE.
--
-- Wrap in a transaction with `SET LOCAL statement_timeout = 0` so this
-- single UPDATE escapes the apply-custom-sql.sh session-level
-- statement_timeout=180000 (CP421). Deploy run 26644645620 (PR #797)
-- hit that 3-min cap on prod's larger youtube_videos table: the seq
-- scan on `LIKE '%&%' OR channel_title LIKE '%&%'` plus the
-- per-row decode function ran ~120s+, abort. Function+trigger had
-- already applied successfully at that point — only the backfill failed.
--
-- Decode is a no-op on already-decoded text, so re-application after
-- a partial run is safe; the next deploy resumes whatever was left.
BEGIN;
SET LOCAL statement_timeout = 0;
UPDATE public.youtube_videos
SET    title         = public.decode_html_entities(title),
       channel_title = public.decode_html_entities(channel_title)
WHERE  title         LIKE '%&%'
   OR  channel_title LIKE '%&%';
COMMIT;
