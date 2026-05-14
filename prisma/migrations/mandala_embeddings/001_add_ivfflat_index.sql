-- IVFFlat cosine index for mandala_embeddings (4096d).
-- Row count 19,369 (2026-05-14, prod) — schema.prisma "after rows accumulate" threshold reached.
-- lists = ceil(N/1000) = 20 per pgvector docs (N < 1M).
-- Used by src/modules/mandala/search.ts:278-305 (Explore template search).
-- CONCURRENTLY to avoid blocking inserts during build (5-10 min @ 19K rows x 4096d).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mandala_emb_cosine
  ON public.mandala_embeddings
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 20);

ANALYZE public.mandala_embeddings;
