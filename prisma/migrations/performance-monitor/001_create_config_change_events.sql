-- ============================================================================
-- Performance monitor — config change ledger (PR1, 2026-07-13 design)
-- ============================================================================
-- Raw DDL companion (prisma db push silent-fail rule): apply manually if the
-- CI push drops the table. Boot self-report inserts one row whenever git_sha
-- or the non-secret flag fingerprint differs from the latest row.
-- Flag: CONFIG_CHANGE_EVENTS_ENABLED (unset = no-op, no reads/writes).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.config_change_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  source              varchar(20) NOT NULL,
  git_sha             varchar(40),
  flags               jsonb,
  diff                jsonb,
  note                text,
  experiment          varchar(12),
  experiment_criteria text
);

CREATE INDEX IF NOT EXISTS idx_config_change_events_created
  ON public.config_change_events (created_at DESC);
