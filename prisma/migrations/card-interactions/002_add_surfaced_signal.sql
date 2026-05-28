-- ============================================================================
-- CP489 Phase 2+3 — add 'surfaced' value to card_signal enum
-- ============================================================================
-- Purpose: track which videos have been shown to a user in a given mandala
-- via add-cards without being acted on (not picked / archived / deleted).
-- The reuse-priority policy in src/api/routes/add-cards.ts then boosts these
-- candidates on subsequent searches instead of treating them as cold misses.
--
-- Idempotent: PostgreSQL 9.6+ supports ADD VALUE IF NOT EXISTS for enums.
-- Note: ALTER TYPE ... ADD VALUE cannot run inside a transaction block on
-- some PostgreSQL versions, so this file is shipped standalone (no BEGIN/
-- COMMIT wrapper). The apply-custom-sql.sh runner already invokes psql
-- per-file without forcing a transaction.
-- ============================================================================

ALTER TYPE public.card_signal ADD VALUE IF NOT EXISTS 'surfaced';
