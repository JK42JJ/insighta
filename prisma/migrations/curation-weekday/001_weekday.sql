-- Weekly curation delivery weekday (KST), 2026-07-27.
--
-- `prisma db push` silently drops new columns on this Supabase project, so the
-- DDL is authored here and applied by hand (local + prod) before the code merges.
-- Applied to prod 2026-07-27 02:28Z; verified: column present, 25/25 rows weekday=1.
--
-- Additive and reversible: 0=Sun..6=Sat, default 1 (Monday) reproduces the
-- delivery day every existing subscription already promised.
-- Rollback: ALTER TABLE public.curation_subscriptions DROP COLUMN weekday;

ALTER TABLE public.curation_subscriptions
  ADD COLUMN IF NOT EXISTS weekday smallint NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_curation_subscriptions_weekday
  ON public.curation_subscriptions (weekday);

-- PostgREST caches the schema; without this it keeps dropping the new column.
NOTIFY pgrst, 'reload schema';
