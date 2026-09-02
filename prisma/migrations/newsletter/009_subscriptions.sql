-- Who reads which brief.
--
-- The only record that existed until now was `newsletter_unsubscribes` — a
-- suppression list, so someone could opt out without an account. Nothing said
-- who had opted *in*, which meant the note surface had no way to know whose
-- reading list an issue belonged on.
--
-- Keyed on the account, not the email address. The address is where a copy was
-- delivered; the account is who reads it, and the two are not always the same
-- person's — a subscriber who signs in with a different address than the one
-- the mail reached is still that reader.
--
--   local : docker exec -i supabase-db-dev sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" \
--             psql -U supabase_admin -d postgres' < 009_subscriptions.sql
--   prod  : psql "$DIRECT_URL" -f 009_subscriptions.sql
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS public.newsletter_subscriptions (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL,
  category_key varchar(40) NOT NULL,
  -- How the reader arrived: 'cta' (the link in an issue), 'app', 'admin'.
  source       varchar(20) NOT NULL DEFAULT 'cta',
  -- The issue whose link brought them, when one did. Answers "which issue
  -- converts", which is the only question worth asking of a first issue.
  from_slug    varchar(80),
  created_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_newsletter_sub_user_category UNIQUE (user_id, category_key),
  -- Accounts live in Supabase's `auth` schema, not `public`. Naming the wrong
  -- one is the kind of mistake the database catches immediately, which is the
  -- argument for the constraint existing at all.
  CONSTRAINT newsletter_subscriptions_user_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_newsletter_sub_category
  ON public.newsletter_subscriptions (category_key);
