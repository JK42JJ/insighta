-- Snapshot track (⑤ get-or-extract): figure snapshot cache.
--
-- Content-scoped cache (one row per video_id + timestamp + figure kind) for the
-- slidegen get-or-extract boundary. A figure is a property of the VIDEO frame at
-- a timestamp, shared across all mandalas/users — so the key is (video_id,
-- ts_sec, kind), NOT user/mandala-scoped (contrast the relevance tables).
--
-- Payload by kind (⑤ contract): chart/diagram/table → struct (numerize JSON);
-- equation → latex; keyframe → asset_path (binary pointer; Supabase Storage
-- wiring is deferred — column is NULLable so struct/latex figures work without
-- any object storage). verification_status carries the R6/verification slot.
--
-- Apply order (mirrors prisma/migrations/book-poc/001_add_table.sql):
--   1. Local: psql "$DATABASE_URL" -f prisma/migrations/snapshot/001_video_figure_snapshots.sql
--   2. Local: prisma db push --skip-generate
--   3. Local: psql "$DATABASE_URL" -c "NOTIFY pgrst, 'reload schema'"
--   4. Prod: deploy.yml CI runs prisma db push (LEVEL-3 silent-fail risk)
--   5. Prod: apply-custom-sql.sh re-applies this raw DDL (defensive; allowlisted)
--   6. Prod: Supabase Dashboard -> Settings -> API -> "Reload schema"

CREATE TABLE IF NOT EXISTS video_figure_snapshots (
  video_id            VARCHAR(11) NOT NULL,
  ts_sec              INTEGER     NOT NULL,
  kind                VARCHAR(16) NOT NULL, -- chart | diagram | table | equation | keyframe
  struct              JSONB,                -- numerize structure (chart/diagram/table)
  latex               TEXT,                 -- equation
  asset_path          TEXT,                 -- keyframe binary pointer (deferred; NULL ok)
  verification_status VARCHAR(16) NOT NULL DEFAULT 'unverified',
  source              VARCHAR(16) NOT NULL DEFAULT 'numerize', -- numerize | manual-warm | cache
  computed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at          TIMESTAMPTZ NOT NULL DEFAULT (NOW() + interval '30 days'),
  PRIMARY KEY (video_id, ts_sec, kind),
  CONSTRAINT chk_vfs_kind CHECK (kind IN ('chart', 'diagram', 'table', 'equation', 'keyframe'))
);

CREATE INDEX IF NOT EXISTS idx_vfs_video ON video_figure_snapshots(video_id);
CREATE INDEX IF NOT EXISTS idx_vfs_expires ON video_figure_snapshots(expires_at);

NOTIFY pgrst, 'reload schema';
