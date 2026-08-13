-- Ontology chat history, moved out of process memory (2026-08-14).
--
-- The store was a Map in the api process, with the source header stating
-- "In-memory conversation store (MVP — no DB persistence)". With one
-- container that works. With two, the second turn of a conversation can land
-- on the other replica and find no history, so the assistant answers as if
-- the exchange had not happened. It is the reason the chart pins api to a
-- single replica.
--
-- Semantics are preserved exactly: a 30-minute idle TTL enforced on read, and
-- a cap on retained turns applied on write. Only the storage changes.
--
-- prisma db push silent-fails on Supabase — apply manually to local AND prod,
-- verify with \d ontology_conversations.
-- Idempotent (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS ontology_conversations (
  id           uuid PRIMARY KEY,
  user_id      uuid,
  -- [{ role: 'user' | 'assistant', content: text }, ...], newest last.
  turns        jsonb       NOT NULL DEFAULT '[]'::jsonb,
  last_access  timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Expiry sweeps delete by last_access; nothing reads the table in any other
-- order, so this is the only index the table needs.
CREATE INDEX IF NOT EXISTS idx_ontology_conversations_last_access
  ON ontology_conversations (last_access);

ALTER TABLE ontology_conversations ENABLE ROW LEVEL SECURITY;
