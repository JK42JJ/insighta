-- error_events — a lightweight, queryable record of subsystem failures that today
-- only reach ephemeral winston logs (container-local error.log, lost on redeploy,
-- not SQL-queryable). The daily error-log-check job reads DB tables; a failure
-- whose ONLY signal is log.error/log.warn is invisible to it. This table closes
-- that gap for the incident-critical paths (book-fill hard-fails that fall back
-- instead of throwing → invisible even to pgboss.job; embedding failures that
-- only log.warn). Append-only; the daily job aggregates + the row ages out.
--
-- NOT a replacement for the per-domain error columns (llm_call_logs.status,
-- mandala_*_error, pgboss.job state='failed', skill_runs.error, …) — those stay
-- authoritative for their domains. This captures ONLY the log-only blind spots.
--
-- Idempotent: CREATE ... IF NOT EXISTS + NOTIFY pgrst (Postgrest schema reload).

CREATE TABLE IF NOT EXISTS public.error_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Coarse subsystem bucket (e.g. 'book_fill', 'embedding'). Group-by axis.
  subsystem   varchar(50)  NOT NULL,
  -- Specific failure stage (e.g. 'topic_synthesis_hardfail', 'skeleton_hardfail',
  -- 'embed_fail'). Finer group-by within a subsystem.
  stage       varchar(80)  NOT NULL,
  -- 'error' (a real failure) | 'warn' (degraded-but-recovered). Default 'error'.
  severity    varchar(20)  NOT NULL DEFAULT 'error',
  -- Human-readable reason (the hard_fail string / caught error message). No secrets.
  message     text,
  -- Structured correlation payload (reason, cell, atomsIn, provider, …). No secrets.
  context     jsonb,
  -- Optional correlation ids so an operator can jump to the affected entity.
  mandala_id  uuid,
  video_id    varchar(50),
  created_at  timestamptz  NOT NULL DEFAULT now()
);

-- Daily job scans a time window and groups by subsystem/stage.
CREATE INDEX IF NOT EXISTS idx_error_events_created_at ON public.error_events (created_at);
CREATE INDEX IF NOT EXISTS idx_error_events_subsystem_created
  ON public.error_events (subsystem, created_at);

-- Postgrest schema reload so the Supabase client sees the new table immediately
-- (ALTER/CREATE → PostgREST caches the schema; without this new tables silent-drop).
NOTIFY pgrst, 'reload schema';
