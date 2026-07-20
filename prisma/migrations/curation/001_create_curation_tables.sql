-- Weekly curation tables (Growth Hub, 2026-07-16).
-- prisma db push silent-fails on Supabase — apply manually to local AND prod,
-- verify with \d public.curation_subscriptions / \d public.curation_items.
--
-- SEPARATE from mandala_subscriptions (social follow graph). A curation is a
-- lightweight consumption feed: relevance-ordered videos + core-segment/full
-- toggle + bookmarks. NO note (book_json) pipeline -> never touches
-- book-fill-gate (no barrier risk). Relevance comes from rich_summary
-- (segment relevance_pct is inline — no separate backfill). week_of keeps each
-- weekly build (snapshot, not overwrite — data-reversibility hard rule).
-- Schema is qualified public.* (search_path-independent).

CREATE TABLE IF NOT EXISTS public.curation_subscriptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL,
  topic       text NOT NULL,
  cadence     varchar(12) NOT NULL DEFAULT 'weekly',
  source      varchar(16) NOT NULL DEFAULT 'discover',
  mandala_id  uuid,
  is_active   boolean NOT NULL DEFAULT true,
  next_run_at timestamptz,
  last_run_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_curation_subscriptions_user_id ON public.curation_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_curation_subscriptions_next_run_at ON public.curation_subscriptions(next_run_at);
ALTER TABLE public.curation_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.curation_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES public.curation_subscriptions(id) ON DELETE CASCADE,
  video_id        varchar(11) NOT NULL,
  relevance_pct   integer NOT NULL,
  position        integer NOT NULL,
  bookmarked_at   timestamptz,
  week_of         date NOT NULL,
  added_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_curation_items_subscription_id ON public.curation_items(subscription_id);
CREATE INDEX IF NOT EXISTS idx_curation_items_sub_week ON public.curation_items(subscription_id, week_of);
ALTER TABLE public.curation_items ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
