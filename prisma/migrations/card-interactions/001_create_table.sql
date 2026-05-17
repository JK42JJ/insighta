-- CP462 (2026-05-17) — Issue #649: card_interactions
--
-- Per docs/runbook/card-preference-signal-handoff-2026-05-15.md §3 (Option B,
-- video-id keyed dedicated table — source-agnostic across user_local_cards
-- and user_video_states). Records explicit user preference signals on
-- recommended/added cards.
--
-- Signal semantics:
--   like           — user heart-clicked the card. Triggers on-demand v2 rich
--                    summary generation + reranker boost. Also sets
--                    pinned_at=now() on the source row (auto-eviction guard).
--   archive        — user wants to stash the card for later WITHIN this
--                    mandala only. UI hides row in the mandala view; row may
--                    be restored within 5s undo window or kept hidden.
--                    Scope: mandala_id required. No global reranker effect.
--   delete         — user explicitly refuses re-recommendation of this video
--                    in any mandala. Scope: mandala_id NULL (user-global).
--                    Reranker applies heavy penalty (Phase 4) and excludes
--                    from candidate supply on subsequent searches.
--   watch_complete — reserved for future watch-time signal (Phase 4+).
--   skip           — reserved for future implicit-negative signal.
--
-- IMPORTANT (CLAUDE.md "prisma db push silent fail" Hard Rule):
--   This file is the source of truth. Apply via psql, NOT via `prisma db
--   push`. After apply, verify:
--     - local DB: docker exec supabase-db-dev psql ... -c "\d card_interactions"
--     - prod DB: psql "$DIRECT_URL" -c "\d card_interactions"
--   And NOTIFY pgrst, 'reload schema' + restart supabase-rest so PostgREST
--   sees the new table/enum.

BEGIN;

-- Enum type (idempotent guard — Postgres CREATE TYPE has no IF NOT EXISTS).
DO $$ BEGIN
  CREATE TYPE public.card_signal AS ENUM (
    'like',
    'archive',
    'delete',
    'watch_complete',
    'skip'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.card_interactions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  video_id   VARCHAR(11) NOT NULL,
  signal     public.card_signal NOT NULL,
  mandala_id UUID REFERENCES public.user_mandalas(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT card_interactions_user_video_signal_uniq
    UNIQUE (user_id, video_id, signal)
);

-- Hot path: reranker reads recent likes/archives/deletes for a user.
CREATE INDEX IF NOT EXISTS idx_card_interactions_user_signal_created
  ON public.card_interactions (user_id, signal, created_at DESC);

-- Lookup by video (e.g. how many users liked this).
CREATE INDEX IF NOT EXISTS idx_card_interactions_video
  ON public.card_interactions (video_id);

-- Mandala-scoped queries (archive within a mandala).
CREATE INDEX IF NOT EXISTS idx_card_interactions_mandala
  ON public.card_interactions (mandala_id)
  WHERE mandala_id IS NOT NULL;

-- RLS — pattern mirror from prisma/migrations/rls_policies.sql
-- (mandala_subscriptions). Users can only read/write their own rows.
ALTER TABLE public.card_interactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own card interactions"
  ON public.card_interactions FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert their own card interactions"
  ON public.card_interactions FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete their own card interactions"
  ON public.card_interactions FOR DELETE
  USING (user_id = auth.uid());

COMMIT;

-- Validation queries:
--   \d public.card_interactions
--   \dT+ public.card_signal
--   SELECT COUNT(*) FROM public.card_interactions;
--   SELECT * FROM pg_policies WHERE tablename = 'card_interactions';
--
-- Rollback (in dev only):
--   BEGIN;
--   DROP TABLE IF EXISTS public.card_interactions;
--   DROP TYPE IF EXISTS public.card_signal;
--   COMMIT;
