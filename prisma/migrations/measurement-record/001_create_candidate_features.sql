-- candidate_features — per-candidate measurement record (SHADOW MODE).
-- One row per (run_id, video_id): source / video / reaction / channel /
-- comment_signals features plus a passthrough filter_trace + relevance_score.
-- Record only — never used for ranking or filtering. YouTube comment text is
-- NEVER stored; comment_signals holds counts only.
--
-- Flag-gated by MEASUREMENT_RECORD_ENABLED (default false). Writer is
-- fire-and-forget (src/modules/measurement/writer.ts). TTL 30 days (expires_at).
--
-- Rollback:
--   DROP TABLE IF EXISTS public.candidate_features;

CREATE TABLE IF NOT EXISTS public.candidate_features (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id              text NOT NULL,
  -- 'track1' | 'track2'
  branch              text NOT NULL,
  video_id            varchar(20) NOT NULL,
  cell                text,
  -- search_keyword | llm_gemini | llm_sonar | chart | other
  source_kind         text,
  keyword             text,
  discovery_paths     integer,
  video               jsonb,
  reaction            jsonb,
  channel             jsonb,
  comment_signals     jsonb,
  filter_trace        jsonb,
  relevance_score     double precision,
  measurement_version integer NOT NULL DEFAULT 1,
  created_at          timestamptz DEFAULT now(),
  expires_at          timestamptz NOT NULL DEFAULT (now() + interval '30 days')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_candidate_features_run_video
  ON public.candidate_features (run_id, video_id);
CREATE INDEX IF NOT EXISTS idx_candidate_features_run
  ON public.candidate_features (run_id);
CREATE INDEX IF NOT EXISTS idx_candidate_features_video
  ON public.candidate_features (video_id);
CREATE INDEX IF NOT EXISTS idx_candidate_features_expires
  ON public.candidate_features (expires_at);

NOTIFY pgrst, 'reload schema';
