-- Withdrawing a brief = hide it, never delete it (decision R40 option a, 2026-11-24). A hidden
-- page keeps its row and content; every app read of morning_pages skips rows with hidden_at set.
-- Additive and idempotent; no existing row is touched (both columns start NULL = visible).
ALTER TABLE public.morning_pages
  ADD COLUMN IF NOT EXISTS hidden_at     timestamptz NULL,
  ADD COLUMN IF NOT EXISTS hidden_reason text        NULL;

-- Write paths (grep "morning_pages" src scripts):
--   hidden_at / hidden_reason are written only by scripts/morning-pages/hide-page.ts and
--   unhide-page.ts (preview by default, --write to apply, staging only).
--   scripts/morning-pages/import-page.ts (ON CONFLICT DO UPDATE) deliberately does NOT list them,
--   so re-importing a hidden page keeps it hidden.
--   Readers (src/modules/morning-feed/pages.ts readHomePages / readPage / listPages, and
--   brief-usage.ts saveBriefFeedback's existence check) all filter hidden_at IS NULL.
--   Kept on purpose: morning_brief_feedback rows and morning_usage_events of a hidden page stay
--   (history of what was already read); only new feedback on it is refused.
-- Rollback: ALTER TABLE public.morning_pages DROP COLUMN hidden_at, DROP COLUMN hidden_reason;
--   (or just revert the read filter; the columns are harmless when unused).
NOTIFY pgrst, 'reload schema';
