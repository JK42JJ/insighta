-- video_domain_fit_cache — R24 SERVE-edge domain-fit ENFORCE cache
-- (search redesign, blast-0). video-intrinsic per-mandala cache, same PK
-- shape as video_mandala_relevance but a DELIBERATELY SEPARATE table — the
-- ENFORCE addition never shares a write path with the existing relevance
-- cache, so it carries zero risk to that table's read/write semantics.
--
-- Avoids a repeat Ollama T3 classification call for the same
-- (video_id, mandala_id) pair across pool-serve-fill's pool + live stages
-- and across separate fill dispatches for the same mandala — domain-fit
-- classification is goal-level (R14-1), i.e. mandala-wide, not per-cell, so
-- one score serves every cell of the mandala.
--
-- Flag-gated by DOMAIN_FIT_SERVE_ENFORCE (default false) — this table stays
-- completely inert (never read or written) until the flag is flipped on. See
-- src/modules/domain-fit-shadow/serve-enforce.ts + serve-cache.ts.
--
-- Per CLAUDE.md "prisma db push Silent Fail 대응": this raw DDL ships
-- alongside the Prisma schema model so the table exists even if
-- `prisma db push` silently no-ops against the Supabase-managed schema.

CREATE TABLE IF NOT EXISTS public.video_domain_fit_cache (
  video_id         varchar(11) NOT NULL,
  mandala_id       uuid NOT NULL REFERENCES public.user_mandalas(id) ON DELETE CASCADE,
  -- '적합' | '비적합'. NULL is never persisted (classifier-unavailable
  -- results fail-open with multiplier=1 and are NOT cached — see
  -- serve-enforce.ts — so a transient Mac Mini outage self-heals on the
  -- next call instead of being pinned as a cached failure).
  fit              varchar(10),
  lexical_conflict boolean NOT NULL DEFAULT false,
  -- Composite deboost multiplier applied at serve time (1.0 = no-op,
  -- DOMAIN_FIT_SERVE_ENFORCE_DEBOOST_MULTIPLIER on a 비적합 verdict).
  multiplier       double precision NOT NULL,
  model            varchar(64) NOT NULL,
  scored_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (video_id, mandala_id)
);

CREATE INDEX IF NOT EXISTS idx_video_domain_fit_cache_mandala
  ON public.video_domain_fit_cache (mandala_id);
