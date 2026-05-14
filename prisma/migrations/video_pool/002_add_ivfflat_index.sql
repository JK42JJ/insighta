-- IVFFlat cosine index for video_pool_embeddings (4096d, qwen3-embedding-8b).
-- Row count 11,123 (2026-05-14, prod) — exceeds 5K threshold in 001_create_tables.sql:49.
-- lists = ceil(N/1000) = 12 per pgvector docs (N < 1M).
-- Used by src/skills/plugins/video-discover/v3/cache-matcher.ts matchFromVideoPool +
-- matchFromVideoPoolByCenterGoal (CP457 carryover T1-2).
-- CONCURRENTLY to avoid blocking inserts during build (5-10 min @ 11K rows x 4096d).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vpool_emb_cosine
  ON public.video_pool_embeddings
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 12);

ANALYZE public.video_pool_embeddings;
