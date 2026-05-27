-- CP488+ (2026-05-27) — v2 Quality Audit MVP (design doc §4.2)
--
-- Daily cron scans every `video_rich_summaries` row (template_version='v2')
-- and writes one score row per video to `v2_quality_audit_log` plus a
-- per-run summary to `v2_quality_audit_runs`. Critical rows enqueue into
-- `v2_quality_regen_queue` for background regeneration (Phase 3).
--
-- Origin: docs/design/v2-quality-audit-system-2026-05-27.md
-- Activation: env `V2_QUALITY_AUDIT_ENABLED=false` by default; cron unregisters
-- when false. Schema is harmless to ship — empty tables until the flag flips.
--
-- IMPORTANT (CLAUDE.md "prisma db push silent fail" Hard Rule, CP486 LEVEL-3
-- family 7th recurrence): this file is the source of truth. Apply via
-- `psql -f` if `prisma db push` silently drops the new tables in Supabase.
-- Post-deploy verify:
--   local: docker exec supabase-db-dev psql -U supabase_admin -d postgres \
--          -c "\d v2_quality_audit_log"
--   prod : bash scripts/ssh-connect.sh \
--          'docker exec insighta-api node -e "..."' (Prisma $queryRaw on
--          information_schema.tables)

BEGIN;

-- ---------------------------------------------------------------------------
-- Per-video per-day audit score
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS v2_quality_audit_log (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id              VARCHAR(11)  NOT NULL,
  audit_date            DATE         NOT NULL,
  audit_run_id          UUID         NOT NULL,
  overall_score         SMALLINT     NOT NULL CHECK (overall_score BETWEEN 0 AND 100),
  m1_range_fit          SMALLINT,
  m2_coverage_start     SMALLINT,
  m3_coverage_end       SMALLINT,
  m4_atoms_range        SMALLINT,
  m5_atoms_distribution SMALLINT,
  m6_atoms_sorted       SMALLINT,
  m7_sections_gap       SMALLINT,
  m8_oneliner_len       SMALLINT,
  model                 VARCHAR(80),
  duration_seconds      INT,
  violations            JSONB,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (video_id, audit_date)
);

CREATE INDEX IF NOT EXISTS idx_v2_audit_video_date
  ON v2_quality_audit_log (video_id, audit_date DESC);

CREATE INDEX IF NOT EXISTS idx_v2_audit_score_date
  ON v2_quality_audit_log (audit_date, overall_score);

CREATE INDEX IF NOT EXISTS idx_v2_audit_run
  ON v2_quality_audit_log (audit_run_id);

-- ---------------------------------------------------------------------------
-- Per-run summary
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS v2_quality_audit_runs (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  run_date        DATE         NOT NULL UNIQUE,
  total_videos    INT          NOT NULL,
  pass_count      INT          NOT NULL,
  warning_count   INT          NOT NULL,
  critical_count  INT          NOT NULL,
  avg_score       REAL,
  by_model        JSONB,
  by_violation    JSONB,
  llm_report_id   UUID,
  started_at      TIMESTAMPTZ  NOT NULL,
  completed_at    TIMESTAMPTZ,
  status          VARCHAR(20)  NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_v2_audit_runs_status
  ON v2_quality_audit_runs (status, run_date DESC);

-- ---------------------------------------------------------------------------
-- Background regeneration queue (Phase 3 reads, Phase 1 only enqueues)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS v2_quality_regen_queue (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id      VARCHAR(11)  NOT NULL,
  priority      SMALLINT     NOT NULL DEFAULT 5,
  reason        TEXT,
  enqueued_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  attempted_at  TIMESTAMPTZ,
  resolved_at   TIMESTAMPTZ,
  status        VARCHAR(20)  NOT NULL DEFAULT 'pending'
);

CREATE INDEX IF NOT EXISTS idx_v2_regen_pending
  ON v2_quality_regen_queue (priority, enqueued_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_v2_regen_video
  ON v2_quality_regen_queue (video_id, status);

COMMIT;

-- Validation:
-- SELECT
--   (SELECT COUNT(*) FROM v2_quality_audit_log)   AS audit_log_rows,
--   (SELECT COUNT(*) FROM v2_quality_audit_runs)  AS audit_runs_rows,
--   (SELECT COUNT(*) FROM v2_quality_regen_queue) AS regen_queue_rows;
