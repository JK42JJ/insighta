-- search_trace / search_trace_candidate — per-request + per-candidate trail log
-- for the v5 live search pipeline (wizard | add_cards | pool_serve). Enables full
-- "Card Journey" reconstruction: generated queries -> candidates received -> each
-- kept/dropped (+reason) -> final cell. Design SSOT:
--   docs/handoffs/insighta-observability-eval-system-design.md (Phase 1)
--
-- Flag-gated by `SEARCH_TRACE_ENABLED` (default false). Even when on, the writer
-- is async fire-and-forget so a DB hiccup never blocks the user-facing serve
-- path (design §10 read-path safety). TTL: 14 days (expires_at lets a cron purge).
--
-- gc / cosine nullability (Phase 1 STEP-1 audit — read before "why is X null?"):
--   * cosine: the v5 serve path has NO embedding cosine anywhere. The only
--     per-candidate similarity is Postgres ts_rank (lexical) on POOL candidates
--     -> `ts_rank` column. `cosine` stays nullable, reserved for offline/harness.
--   * relevance_gc: ONLY async paths populate it (pool-serve fill via
--     computeCardRelevance; wizard inflow-gate). On the add-cards / wizard SYNC
--     serve path gc is INTENTIONALLY NULL — no LLM on the read-path. Live
--     relevance distribution is measured by the golden-cohort offline harness
--     (design §7), NOT from these rows.

CREATE TABLE IF NOT EXISTS public.search_trace (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Groups every candidate + this request together (= pipeline run id).
  trace_id           uuid NOT NULL,
  mandala_id         uuid,
  user_id            uuid,
  -- 'wizard' | 'add_cards' | 'pool_serve'
  trigger            varchar(16) NOT NULL,
  started_at         timestamptz NOT NULL DEFAULT now(),
  finished_at        timestamptz,
  -- [{cell_index, query_text, source}] — cell_index -1 = center-goal query.
  queries_generated  jsonb,
  -- Per-request live search.list units (SSOT across ALL triggers, incl. the
  -- wizard-precompute MISS path). search.list = 100 units/call.
  quota_units        integer,
  queries_attempted  integer,
  queries_succeeded  integer,
  -- attempted - succeeded (429/timeout — upstream has no dedicated counter).
  queries_failed     integer,
  -- {raw, after_dedup, after_filters, scored, placed, dropped} + request-level
  -- drops that are not per-candidate (cell_full / pool_query_dropped / query_failed).
  counts             jsonb,
  -- {cards_count, empty_cells, honest_partial}
  outcome            jsonb,
  algorithm_version  varchar(50),
  created_at         timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz NOT NULL DEFAULT (now() + interval '14 days')
);

CREATE TABLE IF NOT EXISTS public.search_trace_candidate (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Not FK-enforced (fire-and-forget writer must never fail on ordering);
  -- joins to search_trace.trace_id.
  trace_id           uuid NOT NULL,
  -- youtube video id (live) or pool video_id.
  video_id           varchar(64) NOT NULL,
  channel_id         varchar(64),
  channel_title      text,
  -- 'live' | 'pool'
  source_kind        varchar(8) NOT NULL,
  -- cell query that produced the candidate (-1 = center-goal query).
  source_cell_index  integer,
  -- live: the actual query text; pool: null (query text is request-level).
  source_query_text  text,
  -- pool only: v2_promoted | yt_promoted | batch_trend | user_curated.
  source_tier        varchar(16),
  -- fanout | filtered | picked | placed | pool_gated | ...
  stage_reached      varchar(24),
  -- PLACED | DROPPED | DEMOTED (channel soft-cap, not a drop) | KEPT_FAIL_OPEN
  decision           varchar(16) NOT NULL,
  -- candidate-level enum; NULL when PLACED. Values: excluded_owned, blocklist,
  -- shorts, off_lang, pool_no_cell, duplicate, hardcap_overflow, series_dedup,
  -- not_picked, slice_overflow, filter_min_views, filter_duration,
  -- filter_published_after, below_relevance_min, budget_full.
  drop_reason        varchar(32),
  -- async paths only (pool-serve gate / inflow-gate). INTENTIONALLY NULL on the
  -- add-cards / wizard SYNC serve path (see header note).
  relevance_gc       integer,
  -- pool lexical score (rec_score / ts_rank); null on live candidates.
  ts_rank            real,
  -- reserved for offline / harness (embedding cosine). null on the serve path.
  cosine             real,
  -- LLM picker self-report 0..1 (picked candidates only).
  llm_pick_score     real,
  -- LLM picker one-sentence reason (picked candidates only).
  llm_pick_reason    text,
  view_count         bigint,
  duration_sec       integer,
  published_at       timestamptz,
  final_cell_level   integer,
  final_cell_index   integer,
  created_at         timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz NOT NULL DEFAULT (now() + interval '14 days')
);

CREATE INDEX IF NOT EXISTS idx_search_trace_mandala_created
  ON public.search_trace (mandala_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_search_trace_trace
  ON public.search_trace (trace_id);
CREATE INDEX IF NOT EXISTS idx_search_trace_user_created
  ON public.search_trace (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_search_trace_trigger_created
  ON public.search_trace (trigger, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_search_trace_expires
  ON public.search_trace (expires_at);

CREATE INDEX IF NOT EXISTS idx_search_trace_cand_trace
  ON public.search_trace_candidate (trace_id);
CREATE INDEX IF NOT EXISTS idx_search_trace_cand_video
  ON public.search_trace_candidate (video_id);
CREATE INDEX IF NOT EXISTS idx_search_trace_cand_decision
  ON public.search_trace_candidate (decision, drop_reason);
CREATE INDEX IF NOT EXISTS idx_search_trace_cand_expires
  ON public.search_trace_candidate (expires_at);

NOTIFY pgrst, 'reload schema';
