-- Morning feed virtual "today" (stg repeat tests, decision 2026-11-14): one row per account that
-- set a virtual day. No row = the real KST day (unchanged behaviour). Additive and idempotent.
CREATE TABLE IF NOT EXISTS public.morning_virtual_day (
  user_id    uuid        PRIMARY KEY,
  day        date        NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Write paths (grep "morning_virtual_day" src):
--   src/modules/morning-feed/virtual-day.ts setVirtualDay (UPSERT / DELETE), reachable only from
--   POST /morning-feed/test-clock for accounts on MORNING_VIRTUAL_DAY_USER_IDS (staging chart only).
-- Rollback: DROP TABLE public.morning_virtual_day;
NOTIFY pgrst, 'reload schema';
