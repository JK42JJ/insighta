-- Newsletter: the channels an editor has decided are worth reading every week.
--
-- Scope is deliberately narrow. This table is read by the newsletter harvest
-- and by nothing else: not video-discover, not curation, not the Redis
-- `whitelist:channels` set (which belongs to the video-dictionary project and
-- is read-only from here). A trusted channel changes what enters the brief's
-- corpus and has no effect on any other surface.
--
-- Trust means "collect this every week", not "skip the checks". A video from a
-- trusted channel goes through the same format gate and the same cross-
-- validation as one found by search; what trust buys is that the channel is
-- never missed because a query happened not to match it.
--
-- The blocklist wins. A channel present in both `channel_blocklist` and here
-- is blocked — that is enforced in the harvest rather than by a constraint,
-- because the two tables key differently (the blocklist matches on id OR name).
--
-- Cost note: reading a channel's uploads playlist is 1 quota unit against
-- search.list's 100. A trusted list makes the weekly harvest cheaper, not
-- more expensive.
--
--   local : docker exec -i supabase-db-dev sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" \
--             psql -U supabase_admin -d postgres' < 003_trusted_channels.sql
--   prod  : psql "$DIRECT_URL" -f 003_trusted_channels.sql
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS public.newsletter_trusted_channels (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- YouTube channel id (UC...). Resolved from the API, never typed by hand.
  channel_id          varchar(30) NOT NULL,
  -- Display snapshot, so a renamed channel does not blank the row.
  channel_title       text,
  -- contentDetails.relatedPlaylists.uploads, stored from the same channels.list
  -- call. The UC->UU convention holds today and is not a contract; deriving it
  -- would break silently the day it stops.
  uploads_playlist_id varchar(34),
  -- Which brief this channel belongs to. A channel can be trusted for one
  -- topic and irrelevant to another, so the pair is what must be unique.
  category_key        varchar(40) NOT NULL,
  -- 'core'  — collected every week
  -- 'watch' — collected, but ranked below core when the corpus is trimmed
  tier                varchar(10) NOT NULL DEFAULT 'core',
  -- Why an editor trusts it. Required: a list nobody can audit becomes a list
  -- nobody maintains.
  reason              text NOT NULL,
  -- Soft disable, so a channel can be parked without losing why it was added.
  is_active           boolean NOT NULL DEFAULT true,
  -- Incremental cursor: uploads newer than this are "new this week".
  last_seen_at        timestamptz,
  created_by          varchar(100),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_newsletter_trusted_channel
  ON public.newsletter_trusted_channels (category_key, channel_id);

-- The harvest reads one topic's active channels; this is that query.
CREATE INDEX IF NOT EXISTS idx_newsletter_trusted_active
  ON public.newsletter_trusted_channels (category_key, is_active);
