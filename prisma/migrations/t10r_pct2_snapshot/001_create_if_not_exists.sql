-- t10r_pct2_snapshot: T10 judge-round relevance snapshot (CP517, 2026-07-12).
-- Created ad-hoc on prod; this file keeps environments converged under the
-- deploy replay. IF NOT EXISTS = no-op on prod (table already there, 276 rows).
CREATE TABLE IF NOT EXISTS public.t10r_pct2_snapshot (
  src           text,
  row_id        text,
  mandala_id    text,
  video_ref     text,
  relevance_pct integer,
  snapped_at    timestamptz
);
