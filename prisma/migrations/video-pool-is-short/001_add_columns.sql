-- CP491 — YouTube Shorts detection columns on video_pool.
-- Raw SQL DDL companion (prisma db push silent-fails on Supabase auth-owned
-- tables; these ADDs must be applied + verified directly per CLAUDE.md Hard Rule).
--
-- is_short:        true = YouTube Short (demoted, never promoted to search/pick).
--                  NULL = not yet probed OR >=180s (cannot be a Short — YT cap).
-- short_signal:    detection source, e.g. 'shorts_url_redirect' (authoritative).
-- short_probed_at: when the probe ran (for re-probe TTL / audit).
--
-- Apply order: local (docker exec supabase-db-dev) -> verify \d -> NOTIFY pgrst
-- -> restart supabase-rest-dev -> PR -> CI migrate prod -> verify prod \d.

ALTER TABLE public.video_pool ADD COLUMN IF NOT EXISTS is_short boolean;
ALTER TABLE public.video_pool ADD COLUMN IF NOT EXISTS short_signal text;
ALTER TABLE public.video_pool ADD COLUMN IF NOT EXISTS short_probed_at timestamptz;

-- Partial index: only rows still pending a probe within the shorts-eligible
-- duration band (<180s). Keeps backfill + ongoing probe scans cheap.
CREATE INDEX IF NOT EXISTS idx_vpool_short_probe_pending
  ON public.video_pool (duration_seconds)
  WHERE is_short IS NULL AND duration_seconds < 180;

-- PostgREST schema cache reload so the new columns are visible to the API layer.
NOTIFY pgrst, 'reload schema';
