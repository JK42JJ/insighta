-- Migration: add user_note_json JSONB column to user_video_states
-- Purpose: Notion-style side editor (Phase 1-4 MVP). Source of truth for Tiptap JSON rich notes.
-- The existing `user_note` TEXT column is kept and dual-written with a plain-text extract
-- so that the eviction rule in src/modules/mandala/auto-add-recommendations.ts
-- (WHERE user_note IS NULL) continues to work without modification.
--
-- Apply order (per CLAUDE.md DB Work Order):
--   1) Local: psql "$LOCAL_DATABASE_URL" -f prisma/migrations/manual/add_user_note_json.sql
--   2) After PR merge, if the CI `Database Schema Sync` job fails due to the
--      well-known `prisma db push auth ownership` pattern (rec=5),
--      apply manually to prod via:
--        psql "$PROD_DATABASE_URL" -f prisma/migrations/manual/add_user_note_json.sql
--      (Obtain $PROD_DATABASE_URL from memory/credentials.md — do NOT guess.)
--
-- This is an additive, idempotent change. Safe to re-run.

ALTER TABLE public.user_video_states
  ADD COLUMN IF NOT EXISTS user_note_json JSONB;

COMMENT ON COLUMN public.user_video_states.user_note_json IS
  'Tiptap JSON for the Notion-style side editor. Dual-written with user_note (plain text extract) for backwards compatibility with the eviction rule.';
