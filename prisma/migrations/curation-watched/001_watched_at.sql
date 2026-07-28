-- Curation watch mark (redesign contract v1, P1.5 — James gate 2026-07-21).
-- Derived-only column: NULL = unwatched this week. Same-week rebuilds preserve
-- watched_at for retained video_ids; a new week's rows are born NULL (natural
-- weekly reset). Reversible: DROP COLUMN restores the prior shape.
ALTER TABLE public.curation_items
  ADD COLUMN IF NOT EXISTS watched_at timestamptz NULL;
