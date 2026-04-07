-- Trend-based Video Recommendation Engine — Phase 2b schema migration
-- Adds 4096d embedding column to keyword_scores so iks-scorer can store
-- the Qwen3-Embedding-8B vector once, and Phase 3 video-discover can
-- compute per-mandala goal_relevance without re-calling Mac Mini Ollama.
--
-- Design: docs/design/insighta-trend-recommendation-engine.md §4 (goal_relevance)
-- Skill: iks-scorer (#358 Phase 2b, CP352)
--
-- Apply locally:
--   psql "$DATABASE_URL" -f prisma/migrations/video_discover/keyword_scores_embedding.sql
--
-- Note: 4096 dimensions exceed pgvector HNSW index limit (2000d).
-- Brute-force cosine queries are acceptable at expected volume (~40-500 keywords).
-- If volume grows past ~10k keywords, options are:
--   (a) IVFFlat index (supports 4096d, lower recall)
--   (b) Switch to a 1024d or 1536d embedding model
--   (c) Dimensionality reduction via PCA

BEGIN;

-- pgvector extension is already installed (verified 2026-04-07)
-- mandala_embeddings already uses vector(4096) so no schema-level surprises.

ALTER TABLE public.keyword_scores
  ADD COLUMN IF NOT EXISTS embedding vector(4096);

COMMENT ON COLUMN public.keyword_scores.embedding IS
  'Qwen3-Embedding-8B vector (Mac Mini Ollama). NULL until iks-scorer Phase 2b populates it. L2-normalized.';

COMMIT;
