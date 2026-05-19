-- =========================================================================
-- DB-level guard: prevent cell_index regression from a real cell (>= 0)
-- back to scratchpad (-1). Any code path that tries to UPDATE a placed
-- card's cell_index to -1 must fail at the DB boundary so no FE/BE bug
-- can silently strand a user's bookmarked cards in scratchpad again.
--
-- Allowed transitions:
--   * INSERT with any cell_index (including -1)             — fine.
--   * UPDATE cell_index from -1 to >= 0                     — fine (place a card).
--   * UPDATE cell_index from >= 0 to >= 0 (move between cells) — fine.
--   * UPDATE cell_index from >= 0 to -1                     — BLOCKED.
--
-- If a future flow legitimately needs to demote a placed card to
-- scratchpad, it must go through a dedicated /unpin-cell endpoint that
-- bypasses this guard intentionally (e.g. `SET LOCAL session.replication_role`).
--
-- Apply (local):
--   docker exec -i supabase-db-dev psql -U postgres -d postgres \
--     -f prisma/migrations/user-video-states-guards/001_protect_cell_index_regression.sql
-- =========================================================================

CREATE OR REPLACE FUNCTION public.protect_cell_index_regression()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.cell_index IS NOT NULL
     AND OLD.cell_index >= 0
     AND NEW.cell_index = -1
  THEN
    RAISE EXCEPTION
      'cell_index regression blocked: was=% new=% (route through a move endpoint, never via a generic UPSERT)',
      OLD.cell_index, NEW.cell_index
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_cell_index ON public.user_video_states;

CREATE TRIGGER trg_protect_cell_index
  BEFORE UPDATE ON public.user_video_states
  FOR EACH ROW
  WHEN (OLD.cell_index IS DISTINCT FROM NEW.cell_index)
  EXECUTE FUNCTION public.protect_cell_index_regression();
