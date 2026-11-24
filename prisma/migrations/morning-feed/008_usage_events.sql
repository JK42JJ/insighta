-- Morning feed usage events (stg user test, 2026-11-14): append-only log of home/brief/evidence opens
-- and video reactions per viewer. Additive and idempotent; no existing row is touched.
CREATE TABLE IF NOT EXISTS public.morning_usage_events (
  id         bigserial    PRIMARY KEY,
  user_id    uuid         NOT NULL,
  kind       varchar(32)  NOT NULL,
  cell       varchar(50),
  seen_date  date,
  video_id   varchar(32),
  value      varchar(16),
  created_at timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS morning_usage_events_user_created_idx
  ON public.morning_usage_events (user_id, created_at);

-- Write paths (grep "morning_usage_events" src):
--   src/modules/morning-feed/brief-usage.ts recordUsageEvent (INSERT only), reachable only from
--   POST /morning-feed/events. No UPDATE or DELETE anywhere.
-- Rollback: DROP TABLE public.morning_usage_events;
NOTIFY pgrst, 'reload schema';
