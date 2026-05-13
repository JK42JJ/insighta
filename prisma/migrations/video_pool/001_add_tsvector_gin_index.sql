-- video_pool tsvector GIN index for hybrid-rerank keyword expansion
-- CP455 (2026-05-13): PR #612 (V3_ENABLE_HYBRID_RERANK) keyword expansion path
-- queries video_pool via `to_tsvector('simple', title) @@ plainto_tsquery(...)`.
-- Without GIN index, seq scan on 11,291 rows = 753ms/query (measured).
-- With GIN expression index, ~10ms typical.
--
-- Index expression matches hybrid-rerank.ts:tsvectorKeywordCandidates SQL.
-- IF NOT EXISTS guards make this idempotent for repeated deploys.

CREATE INDEX IF NOT EXISTS idx_vpool_title_tsv
  ON public.video_pool
  USING GIN (to_tsvector('simple', coalesce(title, '')));

-- Hybrid coverage: title + description (description matches catch synonym).
CREATE INDEX IF NOT EXISTS idx_vpool_title_desc_tsv
  ON public.video_pool
  USING GIN (
    to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(description, ''))
  );
