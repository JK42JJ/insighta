-- The corpus. One row per video per run, carried through every stage.
--
-- Its absence is the defect this pipeline exists to fix. Issue 1 printed
-- "2,714 harvested, 1,042 reviewed" and cited Insighta's own count; the harvest
-- that produced those numbers stored nothing, so the figures on a page selling
-- graded sourcing were the figures nobody could check. Run
-- bfa50902-055d-4724-9178-ec7e5fb2ac80 repeated it exactly: the ledger has
-- 868 -> 820 -> 457 and 4,039 quota units, and not one of the 457 videos.
--
-- With this table every count a page prints is a query, every drop names the
-- stage that made it, and a run that fails at S5 resumes from S4 instead of
-- spending 4,000 quota units again.
--
--   local : docker exec -i supabase-db-dev sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" \
--             psql -U supabase_admin -d postgres' < 006_corpus.sql
--   prod  : psql "$DIRECT_URL" -f 006_corpus.sql
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS public.newsletter_corpus (
  run_id           uuid        NOT NULL,
  video_id         varchar(20) NOT NULL,

  -- What the harvest saw. Written once at S0 and never rewritten: a later
  -- stage that disagrees records its finding in `enrichment`, so the original
  -- observation stays auditable.
  title            text        NOT NULL,
  channel_id       varchar(40) NOT NULL,
  channel_title    text        NOT NULL,
  published_at     timestamptz NOT NULL,
  duration_seconds integer,
  view_count       bigint,
  -- 'trusted' (an editor decided this channel matters) or 'search'.
  source           varchar(10) NOT NULL,
  -- The query that surfaced it, when layer 2 did.
  query            text,

  -- The last stage this row passed. Resume reads this.
  stage            varchar(12) NOT NULL DEFAULT 'S0_harvest',
  -- Null while the row is still in play.
  dropped_at_stage varchar(12),
  -- Must match a key in that stage's ledger drop_reasons, so the funnel on the
  -- page and the rows in this table are the same statement.
  drop_reason      varchar(60),

  -- S3's verdict: who judged, what they decided, and why.
  verdict          jsonb,
  -- S4's first-party record: description, tags, exact counts from videos.list.
  enrichment       jsonb,
  -- S5: the other rows that carry the same claim.
  corroboration    jsonb,

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (run_id, video_id),
  -- Named the way Prisma names it. A constraint whose name the schema cannot
  -- reproduce shows up as a pending migration forever, which trains everyone
  -- to ignore `migrate diff` output — and that is the check that catches a
  -- column silently dropped.
  CONSTRAINT newsletter_corpus_run_id_fkey FOREIGN KEY (run_id)
    REFERENCES public.newsletter_pipeline_runs (id) ON DELETE CASCADE ON UPDATE CASCADE
);

-- Every stage's first act is "give me the rows that reached the stage before
-- me". Plain b-tree, not partial: Prisma cannot describe a partial index, and
-- a schema that cannot describe the database is what let `prisma db push` drop
-- columns in #1535.
CREATE INDEX IF NOT EXISTS idx_newsletter_corpus_stage
  ON public.newsletter_corpus (run_id, stage);

-- Align a table created by an earlier draft of this file.
ALTER TABLE public.newsletter_corpus
  RENAME CONSTRAINT newsletter_corpus_run_fk TO newsletter_corpus_run_id_fkey;
