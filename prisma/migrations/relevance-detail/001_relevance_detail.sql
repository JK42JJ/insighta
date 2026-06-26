-- CP504 §0.7 — persist rubric axes for relevance scoring.
--
-- The rubric scorer (compute-card-relevance.ts) emits 3 raw axes
-- (cell_fit_pct / goal_contribution_pct / actionability_pct) that compose into
-- relevance_pct. They were LOG-ONLY (James 2026-06-11); persisting them lets the
-- axis-weight re-tuning (0.4/0.4/0.2) be measured instead of guessed.
--
-- Column-add ONLY. No data backfill, no write-path/scoring change. Idempotent.
ALTER TABLE public.user_video_states
  ADD COLUMN IF NOT EXISTS relevance_detail jsonb;

-- Postgrest schema reload so the Supabase client sees the new column
-- (ALTER 직후 reload 누락 시 client silent-drop — CLAUDE.md ALTER 룰).
NOTIFY pgrst, 'reload schema';
