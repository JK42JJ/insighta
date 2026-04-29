-- CP437 (2026-04-29) — pipeline_events table for paper measurement (§6.2).
--
-- Records per-event quality metrics for v2 rich-summary upserts (and any
-- future pipeline stages). Round-keyed for batch-to-batch comparison.
--
-- Spec (user-provided 2026-04-29):
--   stage   = 'rich_summary_v2' | (future stages)
--   payload jsonb = {
--     M1: number,            -- title-word recall ratio in atoms (0..1)
--     M3_class: text,        -- all_null | uniform_fake | insufficient | mixed | real
--     M3_score: number,      -- 0 / 0.5 / (1 - null_ratio)
--     S: number,             -- 0.55 * M1 + 0.45 * M3_score
--     round: int             -- batch round id
--   }
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + indexes IF NOT EXISTS.
-- Hard Rule §raw-SQL-DDL: this file is the source of truth alongside the
-- Prisma model — `prisma db push` may silent-fail on Supabase (auth schema
-- ownership), so this script is applied by `scripts/apply-migrations.sh` in
-- CI Database Schema Sync step.

BEGIN;

CREATE TABLE IF NOT EXISTS public.pipeline_events (
  id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  stage       text          NOT NULL,
  video_id    text          NOT NULL,
  payload     jsonb         NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pipeline_events_stage_video_idx
  ON public.pipeline_events (stage, video_id);

CREATE INDEX IF NOT EXISTS pipeline_events_round_idx
  ON public.pipeline_events ((payload ->> 'round'));

CREATE INDEX IF NOT EXISTS pipeline_events_created_at_idx
  ON public.pipeline_events (created_at DESC);

COMMIT;

-- Validation:
-- SELECT COUNT(*) FROM public.pipeline_events;             -- 0 on first apply
-- \d public.pipeline_events                                -- expects 5 columns
