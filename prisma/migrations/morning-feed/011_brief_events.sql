-- Brief behaviour events and sentence concepts (work order D1, 2026-11-25). Additive and idempotent;
-- no existing row is touched.
--
-- 1. morning_usage_events gets nullable columns for the brief events (the old kinds leave them NULL).
--    Brief id = (brief_owner_id, cell, seen_date). value stays a short token.
--    No UNIQUE on client_event_id: `prisma db push` runs before this file and refuses to add a
--    unique constraint to an existing table; the insert itself skips an id it already has.
ALTER TABLE public.morning_usage_events ADD COLUMN IF NOT EXISTS brief_owner_id  uuid;
ALTER TABLE public.morning_usage_events ADD COLUMN IF NOT EXISTS sentence_id     varchar(16);
ALTER TABLE public.morning_usage_events ADD COLUMN IF NOT EXISTS paragraph       smallint;
ALTER TABLE public.morning_usage_events ADD COLUMN IF NOT EXISTS start_sec       integer;
ALTER TABLE public.morning_usage_events ADD COLUMN IF NOT EXISTS end_sec         integer;
ALTER TABLE public.morning_usage_events ADD COLUMN IF NOT EXISTS from_cell       varchar(50);
ALTER TABLE public.morning_usage_events ADD COLUMN IF NOT EXISTS to_cell         varchar(50);
-- when it happened on the phone (created_at = when it arrived; they differ after a lost request)
ALTER TABLE public.morning_usage_events ADD COLUMN IF NOT EXISTS occurred_at     timestamptz;
ALTER TABLE public.morning_usage_events ADD COLUMN IF NOT EXISTS client_event_id uuid;
CREATE INDEX IF NOT EXISTS morning_usage_events_client_event_idx
  ON public.morning_usage_events (client_event_id);

-- 2. The sentences of a published brief, one set per text (page_hash): a brief written again keeps
--    the older sentences, so an earlier tap still points at the text the reader saw.
CREATE TABLE IF NOT EXISTS public.morning_brief_sentences (
  brief_owner_id  uuid         NOT NULL,
  cell            varchar(50)  NOT NULL,
  seen_date       date         NOT NULL,
  page_hash       varchar(16)  NOT NULL,
  sentence_id     varchar(16)  NOT NULL,
  paragraph       smallint     NOT NULL,
  text            text         NOT NULL,
  -- [{"video_id": "...", "t": 320}]
  evidence        jsonb        NOT NULL DEFAULT '[]'::jsonb,
  -- 'sentence' = the evidence is this sentence's; 'paragraph' = known for its whole paragraph only
  scope           varchar(16)  NOT NULL DEFAULT 'sentence',
  -- morning_pages.updated_at of this text: the version on screen at a time T is the newest <= T
  page_updated_at timestamptz,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (brief_owner_id, cell, seen_date, page_hash, sentence_id)
);

CREATE TABLE IF NOT EXISTS public.morning_brief_concepts (
  brief_owner_id  uuid         NOT NULL,
  cell            varchar(50)  NOT NULL,
  seen_date       date         NOT NULL,
  page_hash       varchar(16)  NOT NULL,
  sentence_id     varchar(16)  NOT NULL,
  type            varchar(16)  NOT NULL,
  -- normalised name: the node a concept is counted under, across briefs and days
  concept_key     varchar(80)  NOT NULL,
  name            varchar(80)  NOT NULL,
  -- who named it, e.g. 'mini-v1' or 'cc-manual'
  method          varchar(32)  NOT NULL,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (brief_owner_id, cell, seen_date, page_hash, sentence_id, type, concept_key)
);
CREATE INDEX IF NOT EXISTS morning_brief_concepts_key_idx
  ON public.morning_brief_concepts (type, concept_key);

-- Apart from CREATE TABLE: `prisma db push` runs first and makes the table without checks.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.morning_brief_concepts'::regclass
       AND conname = 'morning_brief_concepts_type_check'
  ) THEN
    ALTER TABLE public.morning_brief_concepts
      ADD CONSTRAINT morning_brief_concepts_type_check
      CHECK (type IN ('tool', 'product', 'policy', 'company', 'person', 'topic'));
  END IF;
END $$;

-- Same rule as 009/010: no policy, no anon/authenticated access; the API connects as the owner.
ALTER TABLE public.morning_usage_events    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.morning_brief_sentences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.morning_brief_concepts  ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.morning_usage_events    FROM anon, authenticated;
REVOKE ALL ON public.morning_brief_sentences FROM anon, authenticated;
REVOKE ALL ON public.morning_brief_concepts  FROM anon, authenticated;

-- Write paths (grep the table names in src):
--   morning_usage_events    src/modules/morning-feed/brief-usage.ts recordUsageEvent (INSERT only),
--                           reachable only from POST /morning-feed/events. The old kinds keep the old
--                           INSERT (new columns NULL); the brief event kinds write the new columns.
--   morning_brief_sentences, morning_brief_concepts
--                           not written by the app: the ops broker (stgdb/concepts_insert.py), staging.
-- Rollback: DROP TABLE public.morning_brief_concepts, public.morning_brief_sentences;
--   ALTER TABLE public.morning_usage_events DROP COLUMN ... (the nine columns above)
--   (usage records: export them and ask James before dropping anything)
NOTIFY pgrst, 'reload schema';
