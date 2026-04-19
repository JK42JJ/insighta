-- ============================================================================
-- Video Chunk Embeddings — Phase 0 Semantic Rating Layer (CP396)
-- ============================================================================
-- Why raw SQL instead of `prisma db push`:
--   Prisma does not auto-generate HNSW indexes for pgvector columns, and its
--   silent-fail failure mode on Supabase auth-ownership (see CLAUDE.md) has
--   already burned us. Ship the DDL explicitly so production and local agree.
--
-- Shape matches prisma/schema.prisma model `video_chunk_embeddings`, plus the
-- HNSW cosine index the Prisma model cannot declare.
--
-- Populated by the external video-dictionary collector (mac mini) via the same
-- Ollama qwen3-embedding:8b model used for `mandala_embeddings`. See:
--   /cursor/video-dictionary/docs/design/semantic-rating.md
-- ============================================================================

-- Extension: pgvector (already enabled for mandala_embeddings; idempotent).
CREATE EXTENSION IF NOT EXISTS vector;

-- Table
CREATE TABLE IF NOT EXISTS public.video_chunk_embeddings (
  id             bigserial PRIMARY KEY,
  video_id       text      NOT NULL,
  chunk_idx      smallint  NOT NULL,
  text           text      NOT NULL,
  start_time     real      NOT NULL,
  end_time       real      NOT NULL,
  token_count    smallint  NOT NULL,
  embedding      vector(4096) NOT NULL,
  model_version  text      NOT NULL DEFAULT 'qwen3-embedding:8b:Q4_K_M',
  created_at     timestamptz DEFAULT now(),
  CONSTRAINT video_chunk_embeddings_video_chunk_key UNIQUE (video_id, chunk_idx)
);

-- Secondary filter index (used in ANN queries with `WHERE video_id = ANY(...)`).
CREATE INDEX IF NOT EXISTS video_chunk_embeddings_video_id_idx
  ON public.video_chunk_embeddings (video_id);

-- NOTE: No HNSW / IVFFlat index on the embedding column.
--   pgvector 0.8.0 caps both index types at 2000 dimensions for `vector` and
--   4000 for `halfvec`; our 4096-dim `vector` column is out of range for any
--   ANN index today. Query path uses sequential scan inside the
--   `WHERE video_id = ANY($candidates)` predicate — at Phase 0 scale (Redis
--   narrows to ~300 videos × ~20 chunks = ~6000 chunks per query) the scan is
--   <100ms, acceptable.
--
-- Migration path when scale demands ANN (BACKLOG item 14 follow-up):
--   Option A: ALTER COLUMN embedding TYPE halfvec(4096) USING ...
--             + CREATE INDEX ... USING hnsw (embedding halfvec_cosine_ops)
--             Also migrate mandala_embeddings to halfvec(4096) for
--             cross-table cosine compatibility.
--   Option B: Matryoshka-truncate the embedding to 2000 dims via a stored
--             computed column + HNSW on the truncated column.
-- Defer until rows exceed ~50k and query latency exceeds 200ms.

-- PostgREST schema reload — CLAUDE.md LEVEL-2 rule: required after every
-- public-schema DDL so the Supabase REST layer picks up the new table without
-- a container restart.
NOTIFY pgrst, 'reload schema';
