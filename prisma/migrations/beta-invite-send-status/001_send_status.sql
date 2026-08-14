-- Record whether the beta invite email actually went out, 2026-07-27.
--
-- `status='invited'` is written BEFORE the send and the send is non-fatal, so a
-- row claims an invitation was delivered even when SMTP refused it or the
-- transactional-email flag was off. The admin inbox had no way to tell.
--
-- All three columns are nullable on purpose: rows invited before this shipped
-- have an unknown outcome and must render as "확인 불가" rather than be assumed
-- sent. Do not backfill them.
--
-- `prisma db push` silently drops new columns on this Supabase project, so the
-- DDL is authored here and applied by hand (local + prod) before the code merges.
--
-- Rollback:
--   ALTER TABLE public.beta_applications
--     DROP COLUMN invite_email_status,
--     DROP COLUMN invite_email_at,
--     DROP COLUMN invite_email_error;

ALTER TABLE public.beta_applications
  ADD COLUMN IF NOT EXISTS invite_email_status varchar(10),
  ADD COLUMN IF NOT EXISTS invite_email_at     timestamptz,
  ADD COLUMN IF NOT EXISTS invite_email_error  text;

COMMENT ON COLUMN public.beta_applications.invite_email_status IS
  'sent | failed | skipped — outcome of the invite send. NULL = attempted before this column existed, outcome unknown.';

-- PostgREST caches the schema; without this it keeps dropping the new columns.
NOTIFY pgrst, 'reload schema';
