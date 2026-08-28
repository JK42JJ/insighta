-- Weekly brief: issue store + delivery suppression list.
--
-- Raw DDL travels with the Prisma models because `prisma db push` silent-fails
-- against Supabase (auth-schema ownership) and drops new public tables while
-- reporting success. Apply this, then verify with \d before trusting either.
--
--   local : docker exec -e PGPASSWORD=... supabase-db-dev \
--             psql -U supabase_admin -d postgres -f 001_newsletter_issues.sql
--   prod  : psql "$DIRECT_URL" -f 001_newsletter_issues.sql
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS public.newsletter_issues (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug             text NOT NULL UNIQUE,
  category_key     varchar(40) NOT NULL,
  issue_no         integer NOT NULL,
  schema_version   integer NOT NULL DEFAULT 1,
  template_version varchar(20) NOT NULL DEFAULT 'web-v1',
  content_json     jsonb NOT NULL,
  -- NULL = draft. The public read path requires a timestamp, so a draft
  -- cannot be reached by guessing its slug.
  published_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_newsletter_issues_category_no
  ON public.newsletter_issues (category_key, issue_no);

CREATE INDEX IF NOT EXISTS idx_newsletter_issues_published_at
  ON public.newsletter_issues (published_at DESC);

CREATE TABLE IF NOT EXISTS public.newsletter_unsubscribes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           text NOT NULL,
  -- NULL = every category.
  category_key    varchar(40),
  token           text NOT NULL UNIQUE,
  -- NULL = token issued, reader has not opted out.
  unsubscribed_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- A partial unique index rather than a plain one: NULL category_key means
-- "all categories", and in Postgres NULLs are distinct, so a plain unique
-- constraint would let the same address hold several all-category rows.
CREATE UNIQUE INDEX IF NOT EXISTS uq_newsletter_unsub_email_category
  ON public.newsletter_unsubscribes (email, category_key)
  WHERE category_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_newsletter_unsub_email_all
  ON public.newsletter_unsubscribes (email)
  WHERE category_key IS NULL;

CREATE INDEX IF NOT EXISTS idx_newsletter_unsub_email
  ON public.newsletter_unsubscribes (email);
