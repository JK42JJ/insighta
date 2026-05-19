-- ============================================================================
-- CP474 — Promote auto-added + user-pinned rows to user-owned (auto_added=false)
-- ============================================================================
-- Context:
--   Prod sighting (2026-05-19): video F7zg_zmoE-A appeared under the
--   mandala's "Newly Synced" (now "New") tab even though the user had
--   only Heart-clicked it. Investigation found 19 rows across 5 mandalas
--   and 2 users with the bug-shape state (auto_added=true + pinned_at
--   set + cell_index<0 + mandala_id set + is_in_ideation=false).
--
--   schema.prisma:30-32 contract:
--     "User trace on an auto-added row promotes it to permanent
--      (preserved across refreshes)."
--   Promotion was never automated — Heart-click only stamps `pinned_at`,
--   leaving `auto_added=true`. Combined with the original
--   `isNewlySyncedCard` predicate's missing gates this surfaced the row
--   in the wrong tab.
--
-- Action:
--   Flip auto_added=false for every row carrying a user Heart trace.
--   This both:
--     (a) Aligns the row's state with the schema contract.
--     (b) Provides defense-in-depth against the FE predicate — even if a
--         future caller re-reads `auto_added` from the BE for a different
--         filter, the row is now user-owned.
--
-- Scope: rows with auto_added=true AND pinned_at IS NOT NULL — 120 rows
-- on prod (97 already-placed + 23 unplaced) at the time of writing.
--
-- Idempotency: re-running after promotion is a no-op (WHERE clause yields
-- 0 rows). The script's allowlist runs it on every deploy, which is safe.
-- ============================================================================

UPDATE public.user_video_states
   SET auto_added = false,
       updated_at = now()
 WHERE auto_added = true
   AND pinned_at IS NOT NULL;
