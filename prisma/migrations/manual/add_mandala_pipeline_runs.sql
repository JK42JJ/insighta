-- mandala_pipeline_runs: tracks post-creation pipeline with per-step status/timestamp
-- Enables resume-from-failure, audit trail, and future Temporal migration

CREATE TABLE IF NOT EXISTS public.mandala_pipeline_runs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mandala_id     UUID NOT NULL REFERENCES public.user_mandalas(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status         VARCHAR(20) NOT NULL DEFAULT 'pending',
  trigger        VARCHAR(20) NOT NULL DEFAULT 'wizard',

  step1_status     VARCHAR(20),
  step1_started_at TIMESTAMPTZ,
  step1_ended_at   TIMESTAMPTZ,
  step1_result     JSONB,
  step1_error      TEXT,

  step2_status     VARCHAR(20),
  step2_started_at TIMESTAMPTZ,
  step2_ended_at   TIMESTAMPTZ,
  step2_result     JSONB,
  step2_error      TEXT,

  step3_status     VARCHAR(20),
  step3_started_at TIMESTAMPTZ,
  step3_ended_at   TIMESTAMPTZ,
  step3_result     JSONB,
  step3_error      TEXT,

  retry_count  INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_mandala ON public.mandala_pipeline_runs(mandala_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_status ON public.mandala_pipeline_runs(status);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_user ON public.mandala_pipeline_runs(user_id);
