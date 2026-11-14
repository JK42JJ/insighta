-- Morning feed brief feedback (stg user test, 2026-11-14): one row per (viewer, cell, seen date) with
-- the viewer's answer on a shared brief. Additive and idempotent; no existing row is touched.
CREATE TABLE IF NOT EXISTS public.morning_brief_feedback (
  user_id    uuid         NOT NULL,
  cell       varchar(50)  NOT NULL,
  seen_date  date         NOT NULL,
  value      varchar(16)  NOT NULL CHECK (value IN ('useful', 'not_useful')),
  created_at timestamptz  NOT NULL DEFAULT now(),
  updated_at timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, cell, seen_date)
);

-- Write paths (grep "morning_brief_feedback" src):
--   src/modules/morning-feed/brief-usage.ts saveBriefFeedback (INSERT ... ON CONFLICT DO UPDATE),
--   reachable only from POST /morning-feed/pages/feedback. Reads: readBriefFeedback (GET /pages).
-- Rollback: DROP TABLE public.morning_brief_feedback;
NOTIFY pgrst, 'reload schema';
