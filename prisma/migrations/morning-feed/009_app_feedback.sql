-- Morning feed app feedback (decision R30 + work order B4, 2026-11-25): one row per comment a
-- signed-in person sends from the account sheet (kind 'menu') or under a brief (kind 'brief').
-- Additive and idempotent; no existing table or row is touched.
CREATE TABLE IF NOT EXISTS public.morning_app_feedback (
  id             bigserial    PRIMARY KEY,
  user_id        uuid         NOT NULL,
  kind           varchar(16)  NOT NULL DEFAULT 'menu',
  body           text         NOT NULL,
  screen         varchar(32),
  path           varchar(200),
  -- the brief on screen = morning_pages (user_id, cell, seen_date) = (brief_owner_id, cell, seen_date)
  brief_owner_id uuid,
  cell           varchar(50),
  seen_date      date,
  device         varchar(200),
  replay_url     varchar(500),
  created_at     timestamptz  NOT NULL DEFAULT now(),
  -- outbox flag for a notifier that may write; the read-only broker keeps its own last id instead
  notified_at    timestamptz
);
CREATE INDEX IF NOT EXISTS morning_app_feedback_user_created_idx
  ON public.morning_app_feedback (user_id, created_at);

-- Apart from CREATE TABLE: `prisma db push` runs first and may have made the table without checks.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.morning_app_feedback'::regclass
       AND conname = 'morning_app_feedback_kind_check'
  ) THEN
    ALTER TABLE public.morning_app_feedback
      ADD CONSTRAINT morning_app_feedback_kind_check CHECK (kind IN ('menu', 'brief'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.morning_app_feedback'::regclass
       AND conname = 'morning_app_feedback_body_check'
  ) THEN
    ALTER TABLE public.morning_app_feedback
      ADD CONSTRAINT morning_app_feedback_body_check CHECK (char_length(body) BETWEEN 1 AND 2000);
  END IF;
END $$;

-- Free text people wrote: no anon/authenticated access through PostgREST (no policy). The API
-- connects as the table owner, which row level security does not apply to.
ALTER TABLE public.morning_app_feedback ENABLE ROW LEVEL SECURITY;

-- Write paths (grep "morning_app_feedback" src):
--   src/modules/morning-feed/app-feedback.ts saveAppFeedback (INSERT only), reachable only from
--   POST /morning-feed/app-feedback. No UPDATE or DELETE anywhere. notified_at has no writer yet.
-- Reader: the notify broker, docs/ops/app-feedback-notify.md.
-- Rollback: DROP TABLE public.morning_app_feedback;
--   (rows are what people wrote: export them and ask James before dropping)
NOTIFY pgrst, 'reload schema';
