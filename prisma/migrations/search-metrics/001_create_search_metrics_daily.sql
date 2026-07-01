-- search_metrics_daily — Observability Phase 2-B daily rollup (§4 of the design
-- SSOT: docs/handoffs/insighta-observability-eval-system-design.md). One row per
-- day, time-series of the 5 quality axes + pool yield + quota + funnel attrition,
-- tagged with the algorithm_version / flag snapshot. Source = the Phase 1 trail
-- log (search_trace + search_trace_candidate) + video_pool + the live key pool.
--
-- Idempotent: CREATE TABLE / INDEX IF NOT EXISTS + NOTIFY pgrst.
--
-- null vs 0 (READ BEFORE "why is X null?"):
--   * gc_median / gc_pct_below_65 / coverage: relevance + coverage are measured
--     by the golden-cohort OFFLINE harness (design §7), NOT from live requests —
--     no LLM scorer on the serve path. These stay NULL until Phase 3 fills them.
--   * Any axis is NULL when there was nothing to measure that day (e.g. the trace
--     flag SEARCH_TRACE_ENABLED was OFF ⇒ zero trace rows). NULL = "not measured",
--     which the daily report labels distinctly from an actual 0.

CREATE TABLE IF NOT EXISTS public.search_metrics_daily (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The day this row rolls up (yesterday at rollup time). One row per date.
  metric_date           date NOT NULL,

  -- request volume (search_trace rows that day, all triggers)
  requests              integer,

  -- 충분성 (sufficiency) — placed cards per request
  cards_p10             integer,
  cards_p50             integer,
  cards_p90             integer,
  pct_ge_50             real,
  pct_honest_partial    real,

  -- 관련성 (relevance) — Phase 3 golden-cohort offline (NULL until then)
  gc_median             real,
  gc_pct_below_65       real,

  -- 신선도 (freshness)
  pct_le_6mo            real,
  freshness             jsonb, -- {volatile:{pct_le_6mo,n}, evergreen:{...}}

  -- 다양성 (diversity) — over PLACED candidates
  top_channel_share     real,
  channel_hhi           real,

  -- 정합 (integrity)
  pct_view_lt_1000      real,
  off_lang_drops        integer,

  -- 풀 건강 (pool yield)
  pool_active           integer,
  pool_embedded         integer,
  pool_ttl_expired_pct  real,

  -- 쿼타·컴플라이언스 (quota) — active_search_keys is a METRIC here; the alarm
  -- itself fires from the dedicated key-alarm job (Phase 2-A), not this report.
  quota_units_total     integer,
  active_search_keys    integer,

  -- 퍼널 attrition — drop_reason stage counts (jsonb: {reason: n, ...})
  funnel                jsonb,

  -- 커버리지 (coverage) — Phase 3 golden-cohort (NULL until then)
  coverage              jsonb,

  -- version tagging — reproduce which algorithm/flags produced this snapshot
  algorithm_version     varchar(50),
  flags_snapshot        jsonb,

  created_at            timestamptz NOT NULL DEFAULT now()
);

-- One row per day (upsert target) + serves DESC ordering for the delta lookup.
CREATE UNIQUE INDEX IF NOT EXISTS uq_search_metrics_daily_date
  ON public.search_metrics_daily (metric_date);

NOTIFY pgrst, 'reload schema';
