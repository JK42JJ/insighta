-- Note-ready email dedup + send log (2026-07-16 book-fill deadlock fix).
-- Raw DDL accompanies the Prisma model because `prisma db push` silent-fails on
-- Supabase (auth-schema ownership), dropping new public tables while reporting
-- success (CLAUDE.md hard rule, LEVEL-3, 6 recurrences). Apply local + prod and
-- verify with \d note_ready_email_sends on BOTH before CI deploy.
--
-- One row per mandala = the note-ready email was sent once (at-most-once,
-- evergreen). mandala_id PK is the dedup lock the worker claims via
-- INSERT ... ON CONFLICT DO NOTHING RETURNING.

CREATE TABLE IF NOT EXISTS public.note_ready_email_sends (
  mandala_id uuid PRIMARY KEY,
  to_email   text,
  sent_at    timestamptz NOT NULL DEFAULT now()
);

-- Postgrest schema reload so the new table is visible to the API layer.
NOTIFY pgrst, 'reload schema';
