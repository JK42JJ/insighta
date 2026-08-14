-- NEUTRALIZED 2026-07-11 (was: CREATE ivfflat on the 4096d embedding column).
--
-- Same landmine class as video_pool/002_add_ivfflat_index.sql (see the full
-- writeup there): a 4096d ivfflat predating pgvector's 2,000-dim cap.
-- Prod evidence 2026-07-11: idx_scan = 0 AND relation size = 0 bytes — the
-- CONCURRENTLY build had failed, leaving an INVALID zero-byte corpse that
-- never served src/modules/mandala/search.ts. Dropping it changes no query
-- plan; keeping the CREATE here would fail every deploy the moment the
-- index is absent (exactly what video_pool/002 did on 2026-07-11T05:27Z).
DROP INDEX IF EXISTS public.idx_mandala_emb_cosine;
