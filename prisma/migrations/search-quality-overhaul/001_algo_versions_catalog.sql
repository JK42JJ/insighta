-- ============================================================================
-- CP488 — Search Quality Overhaul / D11 measurement oracle
-- Migration 001 — search_algorithm_versions catalog table
-- ============================================================================
-- Purpose: name+parameters JSONB single source of truth for the v3
-- discovery algorithm, so admin can flip the active version (and per-mandala
-- override) without code release. Every run trace + pipeline run stamps the
-- algorithm_version that produced it → A/B comparison oracle.
--
-- Idempotent: CREATE TABLE / INDEX / TYPE / INSERT … ON CONFLICT all use
-- IF NOT EXISTS. Safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.search_algorithm_versions (
  id              VARCHAR(50)  PRIMARY KEY,
  display_name    TEXT         NOT NULL,
  description     TEXT,
  parameters      JSONB        NOT NULL,
  is_active       BOOLEAN      NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  created_by      UUID
);

-- Exactly 1 row may carry is_active = true (global default selector).
-- Use a partial unique index so the column itself stays a plain boolean.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_search_algo_active
  ON public.search_algorithm_versions (is_active)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_search_algo_created
  ON public.search_algorithm_versions (created_at DESC);

-- Seed: 'v1-current' = current prod runtime configuration (probe-verified
-- 2026-05-26 via `docker exec insighta-api printenv`). This is the baseline
-- every future algorithm version (v2…) is compared against.
INSERT INTO public.search_algorithm_versions (id, display_name, description, parameters, is_active)
VALUES (
  'v1-current',
  'v1 — current prod baseline (2026-05-26)',
  'CP461 D-2 unified mandala-filter + Cohere hybrid rerank + V3_TIER1_SOURCES=v2_promoted only + semantic gate 0.5 + V3_TIER2_OVERFETCH=true. Probe-verified prod env snapshot at CP488 start.',
  '{
    "centerGateMode": "semantic",
    "semanticMinCosine": 0.5,
    "tier1Sources": ["v2_promoted"],
    "maxQueries": 20,
    "targetPerCell": 12,
    "recencyWeight": 0.05,
    "recencyHalfLifeMonths": 18,
    "publishedAfterDays": 0,
    "enableHybridRerank": true,
    "enableQualityGate": true,
    "enableSemanticRerank": false,
    "enableWhitelistGate": false,
    "enableRedisProvider": false,
    "enableTier1Cache": true,
    "minViewCount": 1000,
    "minViewsPerDay": 33,
    "tier2Overfetch": true,
    "semanticMaxCandidates": 100,
    "youtubeSearchTimeoutMs": 3000,
    "useYoutubeRankingOnly": false,
    "videoCategoryIds": null,
    "videoDuration": null,
    "llmTemperature": 0.7,
    "cohereTopN": 96,
    "shortsThresholdSec": 75,
    "crossLangFrequency": 5
  }'::jsonb,
  true
)
ON CONFLICT (id) DO NOTHING;
