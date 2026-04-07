-- Mandala generation log — captures LoRA + LLM race outcomes for quality analysis
--
-- Purpose:
--   Even when LoRA loses the race (its result arrives after the user already
--   got the LLM response), its output is still valuable for:
--     - fine-tuning data (valid LoRA outputs that lost on speed)
--     - LoRA-vs-LLM head-to-head quality comparison
--     - Mac Mini latency monitoring (lora_duration_ms trend)
--     - lora_won ratio tracking (validates MLX retraining gains)
--     - automated retrain triggers (recommendation-tuner-style autoresearch)
--
-- Apply to local first:
--   psql "$DATABASE_URL" -f prisma/migrations/video_discover/generation_log.sql

BEGIN;

CREATE TABLE IF NOT EXISTS public.generation_log (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  goal                     TEXT NOT NULL,
  domain                   VARCHAR(100),
  language                 VARCHAR(10) NOT NULL DEFAULT 'ko',

  -- Outcomes
  lora_won                 BOOLEAN NOT NULL,
  source_returned          VARCHAR(20) NOT NULL,  -- 'lora' | 'llm-fallback' | 'failed'

  -- LoRA branch (always captured if LoRA settles, even after losing)
  lora_output              JSONB,                  -- raw mandala JSON
  lora_duration_ms         INTEGER,                -- wall time, may exceed 30s
  lora_valid               BOOLEAN,                -- passed validateMandala
  lora_sub_goals           INTEGER,                -- 8 = structurally ok
  lora_actions_total       INTEGER,                -- aggregate actions count
  lora_action_unique_rate  DOUBLE PRECISION,       -- distinct/total, 1.0 = no dupes
  lora_error               TEXT,

  -- LLM branch (null if LoRA won and LLM was cancelled before completing)
  llm_output               JSONB,
  llm_duration_ms          INTEGER,
  llm_valid                BOOLEAN,
  llm_error                TEXT,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_generation_log_created_at ON public.generation_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_generation_log_lora_won   ON public.generation_log (lora_won);
CREATE INDEX IF NOT EXISTS idx_generation_log_lora_valid ON public.generation_log (lora_valid);
CREATE INDEX IF NOT EXISTS idx_generation_log_user       ON public.generation_log (user_id);
CREATE INDEX IF NOT EXISTS idx_generation_log_language   ON public.generation_log (language);

COMMENT ON TABLE public.generation_log IS
  'Race-fallback outcome log for mandala generation. LoRA branch is captured even on race loss for fine-tuning + analysis.';

COMMIT;
