-- ============================================================================
-- CP488 — Search Quality Overhaul / FLAG sub-PR
-- Migration 004 — v0-pre-cp488 row seed + v1-current row flag refresh
-- ============================================================================
-- Purpose:
--   PR #749 introduced 3 always-on code paths (signal exclude, 0-hit auto-
--   retry, user_curated → video_pool). These are now flag-gated in V3Config
--   so an algorithm row can toggle each one off without a code revert.
--
--   This migration:
--     1. Seeds `v0-pre-cp488` with all CP488 flags set to FALSE → activating
--        this row reproduces pre-CP488 behavior (signals recorded but not
--        consumed, no fallback retry, Heart pool ingest disabled). Useful
--        as the rollback target for A/B comparison.
--     2. Updates `v1-current` parameters to include the 3 new flags with
--        TRUE values → current prod baseline now explicitly reflects the
--        CP488 additions, so a future row deviating from it shows the
--        contrast cleanly.
--
-- Idempotent: ON CONFLICT DO UPDATE on both rows. Safe to re-run.
-- ============================================================================

-- 1) v0-pre-cp488 — rollback target (all CP488 flags OFF)
INSERT INTO public.search_algorithm_versions (id, display_name, description, parameters, is_active)
VALUES (
  'v0-pre-cp488',
  'v0 — pre-CP488 baseline (rollback target)',
  'PR #749 이전 동작 재현. signal exclude / 0-hit auto-retry / user_curated → video_pool 유입 모두 OFF. 단 cost trace + algorithm_version 도장은 코드 path 라 항상 ON (정확한 비교에 필요).',
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
    "crossLangFrequency": 5,
    "enableSignalExclude": false,
    "enableZeroHitRetry": false,
    "enableUserCuratedIngest": false
  }'::jsonb,
  false
)
ON CONFLICT (id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description  = EXCLUDED.description,
  parameters   = EXCLUDED.parameters;

-- 2) v1-current — current prod baseline (CP488 flags ON, explicit)
UPDATE public.search_algorithm_versions
SET parameters = parameters
  || '{"enableSignalExclude": true,
       "enableZeroHitRetry": true,
       "enableUserCuratedIngest": true}'::jsonb,
    description = 'CP461 D-2 unified mandala-filter + Cohere hybrid rerank + V3_TIER1_SOURCES=v2_promoted + semantic gate 0.5 + V3_TIER2_OVERFETCH=true + CP488 hardenings (signal exclude / 0-hit retry / user_curated ingest) ALL ON. Probe-verified prod env snapshot at CP488 start.'
WHERE id = 'v1-current';
