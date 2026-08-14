-- Persist the topic verdict on trend_signals, 2026-07-27.
--
-- Judging runs when the collector runs (twice a day) and the result is stored,
-- so serving — including a user re-rolling proposals — reads a column and issues
-- no LLM calls. Cost is bounded by collection volume, not by traffic.
--
-- judge_state:
--   'ok'      safe and learnable — eligible to be proposed
--   'unsafe'  must never be shown
--   'unfit'   harmless but no weekly study series could be built from it
--             (personal names, song titles, a church name, web-novel chatter)
--   'unknown' judging failed; excluded from serving until re-judged
--   NULL      collected before judging existed; excluded until backfilled
--
-- Rollback:
--   ALTER TABLE public.trend_signals
--     DROP COLUMN judge_state, DROP COLUMN judge_reason,
--     DROP COLUMN judge_model, DROP COLUMN judged_at;

ALTER TABLE public.trend_signals
  ADD COLUMN IF NOT EXISTS judge_state  varchar(8),
  ADD COLUMN IF NOT EXISTS judge_reason text,
  ADD COLUMN IF NOT EXISTS judge_model  varchar(64),
  ADD COLUMN IF NOT EXISTS judged_at    timestamptz;

-- Serving filters on this, and the backfill selects the unjudged by it.
CREATE INDEX IF NOT EXISTS idx_trend_signals_judge_state
  ON public.trend_signals (judge_state);

COMMENT ON COLUMN public.trend_signals.judge_state IS
  'ok | unsafe | unfit | unknown. NULL = collected before judging existed.';

NOTIFY pgrst, 'reload schema';
