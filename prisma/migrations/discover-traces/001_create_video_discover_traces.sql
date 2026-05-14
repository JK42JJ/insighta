-- video_discover_traces — per-step request/response capture for the wizard
-- → dashboard video-discovery pipeline. Enables fact-based verification of
-- the actual LLM prompts, YouTube/Cohere requests, and their responses
-- that produced the recommendation_cache rows the user sees.
--
-- Flag-gated by `V3_TRACE_ENABLED` (default false). Even when on, the writer
-- is fire-and-forget so a DB hiccup never blocks the user-facing pipeline.
-- TTL: 7 days (matching rec_cache lifetime). expires_at lets a cron purge.
--
-- CP457+ instrumentation gap (user feedback: 검증 불가 → 개선 불가).

CREATE TABLE IF NOT EXISTS public.video_discover_traces (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Threading context (may be null when context not yet bound):
  mandala_id    uuid,
  user_id       uuid,
  -- Identifies the pipeline run; multiple steps share one run_id:
  run_id        uuid NOT NULL,
  -- Discrete pipeline step. Free-form to keep new steps additive.
  --   Known values:
  --     'embed.center_goal' | 'embed.titles' | 'embed.sub_goals'
  --     'tier1.match_from_video_pool' | 'tier1.match_by_center_goal'
  --     'tier2.keyword_builder.rule' | 'tier2.keyword_builder.llm'
  --     'tier2.search.list' | 'tier2.videos.batch'
  --     'mandala_filter.semantic_gate'
  --     'hybrid_rerank.tsvector_keyword' | 'hybrid_rerank.cohere'
  --     'auto_add.recommendation_cache' | 'auto_add.user_video_states'
  step          varchar(80) NOT NULL,
  -- 'ok' | 'error' | 'skipped' | 'fallback'
  status        varchar(20) NOT NULL,
  -- Request body (prompt, query string, etc.). jsonb to support nested
  -- structures. SIZE LIMIT enforced application-side (truncate at 64KB).
  request       jsonb,
  -- Response body (LLM output, API response, query rows). Same size cap.
  response      jsonb,
  -- Optional human-readable error (status='error').
  error_message text,
  latency_ms    integer,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL DEFAULT (now() + interval '7 days')
);

CREATE INDEX IF NOT EXISTS idx_video_discover_traces_mandala_created
  ON public.video_discover_traces (mandala_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_video_discover_traces_run
  ON public.video_discover_traces (run_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_video_discover_traces_user_created
  ON public.video_discover_traces (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_video_discover_traces_expires
  ON public.video_discover_traces (expires_at);

NOTIFY pgrst, 'reload schema';
