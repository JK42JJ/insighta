-- CP499+ A-2 — pre-placement relevance gate cache (video x mandala).
-- Lazy-filled by the pool-serving / auto-add gate; consumers ship in later PRs.
-- First-serve scoring is ASYNC by design (W1b "filling" state; no sync block).
-- Idempotent: IF NOT EXISTS throughout (apply-custom-sql.sh contract).
CREATE TABLE IF NOT EXISTS public.video_mandala_relevance (
  video_id      varchar(11) NOT NULL,
  mandala_id    uuid        NOT NULL REFERENCES public.user_mandalas(id) ON DELETE CASCADE,
  relevance_pct int         NOT NULL,
  relevance_at  timestamptz NOT NULL DEFAULT now(),
  detail        jsonb,
  PRIMARY KEY (video_id, mandala_id)
);
CREATE INDEX IF NOT EXISTS idx_vmr_mandala ON public.video_mandala_relevance (mandala_id);
