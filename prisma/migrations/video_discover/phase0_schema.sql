-- Trend-based Video Recommendation Engine — Phase 0 schema
-- Design: docs/design/insighta-trend-recommendation-engine.md
-- Skill ID: video-discover
--
-- Apply to local first:
--   psql "$DATABASE_URL" -f prisma/migrations/video_discover_phase0.sql
--
-- Then apply keyword_accuracy_view.sql (depends on these tables).

BEGIN;

-- Layer 1: trend_signals
CREATE TABLE IF NOT EXISTS public.trend_signals (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source      VARCHAR(50) NOT NULL,
  domain      VARCHAR(100),
  keyword     VARCHAR(255) NOT NULL,
  raw_score   DOUBLE PRECISION NOT NULL,
  norm_score  DOUBLE PRECISION NOT NULL,
  velocity    DOUBLE PRECISION NOT NULL DEFAULT 0,
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
  language    VARCHAR(10) NOT NULL DEFAULT 'ko',
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  CONSTRAINT trend_signals_source_keyword_lang_unique UNIQUE (source, keyword, language)
);
CREATE INDEX IF NOT EXISTS idx_trend_signals_keyword          ON public.trend_signals (keyword);
CREATE INDEX IF NOT EXISTS idx_trend_signals_expires_at       ON public.trend_signals (expires_at);
CREATE INDEX IF NOT EXISTS idx_trend_signals_source_fetched   ON public.trend_signals (source, fetched_at DESC);

-- Layer 2: keyword_scores (IKS, 6 axes)
CREATE TABLE IF NOT EXISTS public.keyword_scores (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword             VARCHAR(255) NOT NULL,
  domain              VARCHAR(100),
  language            VARCHAR(10) NOT NULL DEFAULT 'ko',
  iks_total           DOUBLE PRECISION NOT NULL,
  search_demand       DOUBLE PRECISION,
  competition         DOUBLE PRECISION,
  trend_velocity      DOUBLE PRECISION,
  goal_relevance      DOUBLE PRECISION,
  learning_value      DOUBLE PRECISION,
  content_performance DOUBLE PRECISION,
  weight_version      INT NOT NULL DEFAULT 1,
  scored_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at          TIMESTAMPTZ NOT NULL,
  CONSTRAINT keyword_scores_keyword_lang_unique UNIQUE (keyword, language)
);
CREATE INDEX IF NOT EXISTS idx_keyword_scores_iks_desc       ON public.keyword_scores (iks_total DESC);
CREATE INDEX IF NOT EXISTS idx_keyword_scores_domain_lang    ON public.keyword_scores (domain, language);
CREATE INDEX IF NOT EXISTS idx_keyword_scores_expires_at     ON public.keyword_scores (expires_at);

-- Layer 3: recommendation_cache
CREATE TABLE IF NOT EXISTS public.recommendation_cache (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mandala_id      UUID NOT NULL REFERENCES public.user_mandalas(id) ON DELETE CASCADE,
  cell_index      INT,
  keyword         VARCHAR(255) NOT NULL,
  domain          VARCHAR(100),
  video_id        VARCHAR(64) NOT NULL,
  title           TEXT NOT NULL,
  thumbnail       TEXT,
  channel         VARCHAR(255),
  channel_subs    INT,
  view_count      INT,
  like_ratio      DOUBLE PRECISION,
  duration_sec    INT,
  rec_score       DOUBLE PRECISION NOT NULL,
  iks_score       DOUBLE PRECISION,
  trend_keywords  JSONB NOT NULL DEFAULT '[]'::jsonb,
  rec_reason      TEXT,
  status          VARCHAR(20) NOT NULL DEFAULT 'pending',
  weight_version  INT NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,
  CONSTRAINT recommendation_cache_user_mandala_video_unique UNIQUE (user_id, mandala_id, video_id)
);
CREATE INDEX IF NOT EXISTS idx_recommendation_cache_user_mandala_status ON public.recommendation_cache (user_id, mandala_id, status);
CREATE INDEX IF NOT EXISTS idx_recommendation_cache_rec_score_desc      ON public.recommendation_cache (rec_score DESC);
CREATE INDEX IF NOT EXISTS idx_recommendation_cache_expires_at          ON public.recommendation_cache (expires_at);
CREATE INDEX IF NOT EXISTS idx_recommendation_cache_keyword             ON public.recommendation_cache (keyword);

-- Layer 4: recommendation_feedback
CREATE TABLE IF NOT EXISTS public.recommendation_feedback (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recommendation_id UUID NOT NULL REFERENCES public.recommendation_cache(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action            VARCHAR(20) NOT NULL,
  action_score      DOUBLE PRECISION NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_recommendation_feedback_rec          ON public.recommendation_feedback (recommendation_id);
CREATE INDEX IF NOT EXISTS idx_recommendation_feedback_user_created ON public.recommendation_feedback (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_recommendation_feedback_action       ON public.recommendation_feedback (action);

-- Layer 5: scoring_weights
CREATE TABLE IF NOT EXISTS public.scoring_weights (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version             INT NOT NULL UNIQUE,
  search_demand       DOUBLE PRECISION NOT NULL DEFAULT 0.15,
  competition         DOUBLE PRECISION NOT NULL DEFAULT 0.10,
  trend_velocity      DOUBLE PRECISION NOT NULL DEFAULT 0.15,
  goal_relevance      DOUBLE PRECISION NOT NULL DEFAULT 0.25,
  learning_value      DOUBLE PRECISION NOT NULL DEFAULT 0.20,
  content_performance DOUBLE PRECISION NOT NULL DEFAULT 0.15,
  accuracy_before     DOUBLE PRECISION,
  accuracy_after      DOUBLE PRECISION,
  approved_by         VARCHAR(50),
  reason              TEXT,
  active              BOOLEAN NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_scoring_weights_active ON public.scoring_weights (active);

-- Seed: initial weight version v1
INSERT INTO public.scoring_weights (version, active, approved_by, reason)
VALUES (1, true, 'auto', 'Initial weights from design doc (Phase 0)')
ON CONFLICT (version) DO NOTHING;

COMMIT;
