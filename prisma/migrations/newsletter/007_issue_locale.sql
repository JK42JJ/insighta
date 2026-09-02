-- Which language an issue is written in.
--
-- The pipeline harvests Korean and English and the corpus is 94% English by
-- source: of the 274 videos the 2026-08-31 run passed, 250 are spoken in
-- English and 15 in Korean, and the largest Korean-language "source" in it is
-- a channel that reposts English conference talks with Korean subtitles.
--
-- That asymmetry is the product: the brief converts material a Korean
-- practitioner cannot easily consume into something they can. An English
-- edition would add selection alone, against incumbents who already do that,
-- and would double the one recurring human cost — the pass that removes
-- machine-sounding prose — every week.
--
-- So the launch is Korean only, and this column exists so that decision is
-- recorded rather than assumed. `(category_key, issue_no, locale)` is the
-- identity: one issue number, one edition per language. Adding English later
-- is a row, not a migration.
--
--   local : docker exec -i supabase-db-dev sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" \
--             psql -U supabase_admin -d postgres' < 007_issue_locale.sql
--   prod  : psql "$DIRECT_URL" -f 007_issue_locale.sql
--
-- Idempotent.

-- Default 'ko' because every existing row is Korean, and NOT NULL because a
-- page has to know what to put in <html lang>: getting that wrong tells a
-- screen reader to pronounce Korean as English.
ALTER TABLE public.newsletter_issues
  ADD COLUMN IF NOT EXISTS locale varchar(5) NOT NULL DEFAULT 'ko';

-- Issue 1 in Korean and issue 1 in English are the same issue, so the old
-- (category_key, issue_no) constraint would have made the second edition
-- impossible to store.
ALTER TABLE public.newsletter_issues
  DROP CONSTRAINT IF EXISTS uq_newsletter_issues_category_no;
DROP INDEX IF EXISTS public.uq_newsletter_issues_category_no;

CREATE UNIQUE INDEX IF NOT EXISTS uq_newsletter_issues_category_no_locale
  ON public.newsletter_issues (category_key, issue_no, locale);
