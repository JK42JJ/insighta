-- Pin / bookmark — explicit "save for later" signal on grid cards.
-- CP457+ behavioral capture for recommendation ranking dictionary.
--
-- One column per card source table. NULL = not pinned. Timestamp = pinned moment.
-- Indexed for filter ("show pinned only") + analytics (recent pins by user).
--
-- prisma db push silent-fail safe — raw DDL applied directly to both local +
-- prod. CI deploy.yml runs `prisma db push` AFTER, which becomes a no-op
-- when the column already exists.

ALTER TABLE public.user_local_cards
  ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_user_local_cards_pinned_at
  ON public.user_local_cards (user_id, pinned_at DESC NULLS LAST)
  WHERE pinned_at IS NOT NULL;

ALTER TABLE public.user_video_states
  ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_user_video_states_pinned_at
  ON public.user_video_states (user_id, pinned_at DESC NULLS LAST)
  WHERE pinned_at IS NOT NULL;

-- Reload PostgREST schema cache (Supabase) so the new column is visible
-- to the Edge Function joins. CLAUDE.md "ALTER 직후 Postgrest Schema Reload" rule.
NOTIFY pgrst, 'reload schema';
