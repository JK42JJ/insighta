-- Forward migration for a database already carrying 001's first shape.
--
-- 001 modelled "every category" as a NULL category_key. Postgres treats NULLs
-- as distinct, so uniqueness then needs two partial indexes -- and Prisma
-- cannot describe a partial index. Every deploy therefore had `prisma db push`
-- see a missing plain unique constraint of the same name, try to add it, and
-- stop on the data-loss check. The schema and the database were describing
-- two different tables and only one of them could win.
--
-- A sentinel value says the same thing in a shape both can hold.
--
--   local : docker exec -e PGPASSWORD=... supabase-db-dev \
--             psql -U supabase_admin -d postgres -f 002_newsletter_unsub_category_sentinel.sql
--   prod  : psql "$DIRECT_URL" -f 002_newsletter_unsub_category_sentinel.sql
--
-- Idempotent: safe to re-run.

UPDATE public.newsletter_unsubscribes SET category_key = 'all' WHERE category_key IS NULL;

ALTER TABLE public.newsletter_unsubscribes ALTER COLUMN category_key SET DEFAULT 'all';
ALTER TABLE public.newsletter_unsubscribes ALTER COLUMN category_key SET NOT NULL;

DROP INDEX IF EXISTS public.uq_newsletter_unsub_email_all;
DROP INDEX IF EXISTS public.uq_newsletter_unsub_email_category;

CREATE UNIQUE INDEX IF NOT EXISTS uq_newsletter_unsub_email_category
  ON public.newsletter_unsubscribes (email, category_key);
