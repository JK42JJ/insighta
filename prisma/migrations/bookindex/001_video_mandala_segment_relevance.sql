-- Book-index track (feat/bookindex-schema): segment-level relevance sidecar.
--
-- Finer-grain SIBLING of the existing `video_mandala_relevance` table
-- (PK (video_id, mandala_id), whole-video score). This table stores the
-- per-time-segment relevance that slidegen's relevance gate consumes to
-- narrow a video to its on-goal time ranges before rendering snapshots.
--
-- Keyed by (video_id, mandala_id, segment_idx): mandala-scoped, so it is
-- leak-safe by the same invariant as video_mandala_relevance — a mandala is
-- single-user-owned, and each mandala carries its own centerGoal, so the
-- same video segment legitimately scores differently per mandala without one
-- user's score bleeding onto another (contrast video_rich_summaries.segments[]
-- .relevance_pct, which is keyed by video_id alone = cross-user shared).
--
-- segment_idx mirrors rich_summary segments.sections[] index, BUT that index
-- is NOT stable across rich-summary regeneration: sections are LLM-emitted and
-- the section count/boundaries adapt per run (rich-summary-v2-prompt.ts:270).
-- from_sec/to_sec are transcript-anchored ground truth (prompt:278) and travel
-- as the stable anchor for re-matching after regeneration. computed_at lets a
-- consumer detect staleness vs video_rich_summaries.updated_at (invalidation
-- policy lives in the fill job track, not this schema).
--
-- Apply order (mirrors prisma/migrations/book-poc/001_add_table.sql):
--   1. Local: psql "$DATABASE_URL" -f prisma/migrations/bookindex/001_video_mandala_segment_relevance.sql
--   2. Local: prisma db push --skip-generate (sync Prisma)
--   3. Local: psql "$DATABASE_URL" -c "NOTIFY pgrst, 'reload schema'"
--   4. Prod: deploy.yml CI runs prisma db push (LEVEL-3 silent-fail risk)
--   5. Prod: apply-custom-sql.sh re-applies this raw DDL (defensive; allowlisted)
--   6. Prod: Supabase Dashboard -> Settings -> API -> "Reload schema"

CREATE TABLE IF NOT EXISTS video_mandala_segment_relevance (
  video_id      VARCHAR(11) NOT NULL,
  mandala_id    UUID        NOT NULL REFERENCES user_mandalas(id) ON DELETE CASCADE,
  segment_idx   INTEGER     NOT NULL,
  from_sec      INTEGER     NOT NULL,
  to_sec        INTEGER     NOT NULL,
  relevance_pct INTEGER     NOT NULL,
  computed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (video_id, mandala_id, segment_idx),
  CONSTRAINT chk_vmsr_relevance_pct CHECK (relevance_pct BETWEEN 0 AND 100),
  CONSTRAINT chk_vmsr_sec_order CHECK (to_sec >= from_sec)
);

CREATE INDEX IF NOT EXISTS idx_vmsr_mandala
  ON video_mandala_segment_relevance(mandala_id, video_id);

NOTIFY pgrst, 'reload schema';
