-- Newsletter: what each stage received, what it passed on, and what it dropped.
--
-- Issue 1 could not be reconstructed. The harvest ran once from a script that
-- was never committed, its 40 queries were never written down, and the funnel
-- figures printed on the page ("2,714 -> 1,042") exist only as prose in a
-- handoff document. The claim on the page — "1,042 videos reviewed" — cites
-- Insighta's own count, and that count has no record behind it.
--
-- These two tables are the fix. A stage that ends without a row here did not
-- happen as far as the next issue is concerned, and a figure that cannot be
-- read back out of them does not go on the page.
--
--   local : docker exec -i supabase-db-dev sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" \
--             psql -U supabase_admin -d postgres' < 004_pipeline_runs.sql
--   prod  : psql "$DIRECT_URL" -f 004_pipeline_runs.sql
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS public.newsletter_pipeline_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_key  varchar(40) NOT NULL,
  -- Which week this run is for. Two runs on the same week are a re-run, not a
  -- second issue, so the slug they feed stays the identity of the output.
  week_of       date NOT NULL,
  -- 'running' | 'complete' | 'failed' | 'abandoned'
  status        varchar(12) NOT NULL DEFAULT 'running',
  -- The exact topic definition this run used. Copied in rather than referenced,
  -- because the definition file changes and a finished run must keep saying
  -- what it actually did.
  topic_snapshot jsonb NOT NULL,
  started_at    timestamptz NOT NULL DEFAULT now(),
  ended_at      timestamptz,
  -- Quota spent, so the cost of an issue is a number and not a guess.
  quota_units   integer NOT NULL DEFAULT 0,
  error         text,
  created_by    varchar(100)
);

CREATE INDEX IF NOT EXISTS idx_newsletter_runs_week
  ON public.newsletter_pipeline_runs (category_key, week_of DESC);

CREATE TABLE IF NOT EXISTS public.newsletter_pipeline_steps (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id      uuid NOT NULL REFERENCES public.newsletter_pipeline_runs(id) ON DELETE CASCADE ON UPDATE CASCADE,
  -- 'S0_harvest' | 'S1_format' | 'S2_domain' | 'S3_judge'
  -- 'S4_deep'    | 'S5_cross'  | 'S6_stats'  | 'S7_draft'
  stage       varchar(16) NOT NULL,
  -- Items handed to this stage and items it passed on. The difference is what
  -- it dropped, and `drop_reasons` says why — a bare count is a claim without
  -- evidence, which is the failure this whole table exists to stop.
  items_in    integer NOT NULL,
  items_out   integer NOT NULL,
  -- { "shorts": 1672, "duplicate": 40, ... } — must sum to items_in - items_out
  drop_reasons jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Cost attribution per stage: quota for the API stages, USD for the LLM ones.
  quota_units integer NOT NULL DEFAULT 0,
  cost_usd    double precision,
  duration_ms integer,
  -- Anything a later reader needs that is not a count: the queries used, the
  -- channels read, the judge model, the videos that survived.
  detail      jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- One row per stage per run. A stage that reports twice is a bug, not two
-- stages, and the constraint says so rather than leaving it to be noticed.
CREATE UNIQUE INDEX IF NOT EXISTS uq_newsletter_step_run_stage
  ON public.newsletter_pipeline_steps (run_id, stage);

CREATE INDEX IF NOT EXISTS idx_newsletter_steps_run
  ON public.newsletter_pipeline_steps (run_id);
