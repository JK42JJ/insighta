-- =========================================================================
-- Regression fix (CP489, 2026-05-29):
--   The 001_protect_cell_index_regression.sql trigger (PR #676, CP474,
--   2026-05-19) blocks ANY `cell_index >= 0 -> -1` UPDATE at the DB
--   boundary to prevent the `cards.ts /like` ON CONFLICT bookmark-data-loss
--   incident. The original comment promised a dedicated `/unpin-cell`
--   endpoint as the bypass for intentional scratchpad demotion, but that
--   endpoint was never implemented — so every legitimate scratchpad/delete
--   move (handleScratchPadCardDrop / handleScratchPadMultiCardDrop /
--   handleDeleteCards isInMandala) has been silently failing since 5/19.
--
--   User-reported symptom (CP489): "12개 카드 selected -> 아이디어스팟 drag
--   -> toast '12개 이동' but only 1 card actually moved". BE log showed 11x
--   `code 23514 cell_index regression blocked: was=4 new=-1`. The 1 success
--   was a local/pending card (user_local_cards table, no trigger).
--
--   This migration internalises the SQL comment's promise INTO the trigger
--   itself: the trigger now skips the regression check when the UPDATE
--   carries the full intentional-demotion signature
--   (`level_id='scratchpad' AND mandala_id IS NULL`). Silent stranding
--   (cell_index=-1 alone, level_id retained, mandala_id retained) is still
--   blocked — the original protection intent is preserved.
--
-- Allowed transitions:
--   * INSERT with any cell_index (including -1)                  — fine (unchanged).
--   * UPDATE cell_index from -1 to >= 0                          — fine (place a card; unchanged).
--   * UPDATE cell_index from >= 0 to >= 0 (move between cells)   — fine (unchanged).
--   * UPDATE cell_index from >= 0 to -1
--       WITH level_id='scratchpad' AND mandala_id IS NULL        — fine (intentional demote; NEW).
--   * UPDATE cell_index from >= 0 to -1
--       WITHOUT the full demote signature                        — BLOCKED (silent stranding).
--
-- All current FE/BE/EF callers that demote a card to scratchpad already
-- set the full 4-tuple (cell_index=-1 + is_in_ideation + level_id='scratchpad'
-- + mandala_id=NULL) — verified by exhaustive grep before authoring this
-- migration:
--   * useCardOrchestrator.ts:1270-1273 (handleScratchPadCardDrop synced)
--   * useCardOrchestrator.ts:1322 (handleScratchPadMultiCardDrop batchItems)
--     -> useBatchMoveCards.ts:53-66 batch-update-video-state EF item
--   * useCardOrchestrator.ts:1477-1480 (handleDeleteCards isInMandala)
--
-- Apply (local):
--   docker exec -i supabase-db-dev psql -U postgres -d postgres \
--     -f prisma/migrations/user-video-states-guards/002_allow_intentional_scratchpad_move.sql
--
-- Apply (prod): handled by CI/CD deploy.yml schema-sync step. CREATE OR
-- REPLACE FUNCTION is idempotent — safe to re-apply.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.protect_cell_index_regression()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.cell_index IS NOT NULL
     AND OLD.cell_index >= 0
     AND NEW.cell_index = -1
     -- Allow intentional scratchpad/delete demotion: the explicit pair
     -- (level_id='scratchpad' AND mandala_id IS NULL) signals a UI-driven
     -- move via handleScratchPadCardDrop / handleScratchPadMultiCardDrop /
     -- handleDeleteCards. Silent stranding (cell_index=-1 alone) still
     -- blocked.
     AND NOT (NEW.level_id = 'scratchpad' AND NEW.mandala_id IS NULL)
  THEN
    RAISE EXCEPTION
      'cell_index regression blocked: was=% new=% (set level_id=scratchpad + mandala_id=NULL together to demote intentionally; partial UPSERT still blocked)',
      OLD.cell_index, NEW.cell_index
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- Trigger row binding is unchanged (FOR EACH ROW + BEFORE UPDATE + WHEN
-- (OLD.cell_index IS DISTINCT FROM NEW.cell_index) already established
-- by 001). Only the function body changes — CREATE OR REPLACE swaps it
-- atomically without DROP TRIGGER / CREATE TRIGGER. Idempotent.
