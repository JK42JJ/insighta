-- Channel blocklist (P0 scam-inflow, 2026-07-03).
-- Matching is channel_id when present, exact channel_name otherwise
-- (the two seed scam channels shipped with channel_id NULL).
-- Idempotent: safe to re-run (apply-custom-sql.sh allowlist).
CREATE TABLE IF NOT EXISTS public.channel_blocklist (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id    varchar(64),
  channel_name  varchar(200),
  reason        text NOT NULL,
  created_by    varchar(100),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT channel_blocklist_target CHECK (channel_id IS NOT NULL OR channel_name IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_blocklist_channel_id
  ON public.channel_blocklist (channel_id) WHERE channel_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_blocklist_channel_name
  ON public.channel_blocklist (channel_name) WHERE channel_name IS NOT NULL;
-- Rollback: DROP TABLE IF EXISTS public.channel_blocklist;
