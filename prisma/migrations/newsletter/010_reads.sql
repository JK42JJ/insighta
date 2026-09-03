-- Which issues a reader has opened.
--
-- Separate from `newsletter_subscriptions` because the two are keyed
-- differently: a subscription is per category and lasts, a read is per issue
-- and happens once. Folded into one table there would be no way to express
-- "subscribed, and has not opened this week's" — which is the only state the
-- sidebar badge cares about.
--
-- Recorded on arrival rather than on scroll depth or dwell time. Those are
-- measurable and they answer a question this product is not asking yet; a row
-- here means the reader opened the issue, and nothing more is claimed.
--
--   local : docker exec -i supabase-db-dev sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" \
--             psql -U supabase_admin -d postgres' < 010_reads.sql
--   prod  : psql "$DIRECT_URL" -f 010_reads.sql
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS public.newsletter_reads (
  user_id uuid        NOT NULL,
  -- The issue's slug rather than its id: slugs are what links carry, so a read
  -- can be recorded from a URL without a lookup, and a slug is stable.
  slug    varchar(80) NOT NULL,
  read_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (user_id, slug),
  CONSTRAINT newsletter_reads_user_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE,
  CONSTRAINT newsletter_reads_slug_fkey
    FOREIGN KEY (slug) REFERENCES public.newsletter_issues (slug) ON DELETE CASCADE
);

-- The badge asks "which of this reader's issues are unread", which reads every
-- row for one user.
CREATE INDEX IF NOT EXISTS idx_newsletter_reads_user
  ON public.newsletter_reads (user_id);
