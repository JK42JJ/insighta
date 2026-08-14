-- Channel-based curation: the channels a subscription follows, 2026-07-27.
--
-- Design: docs/design/curation-channel-subscription-2026-07-27.md
--
-- One subscription follows N channels, so this is a separate table rather than
-- an array column: unsubscribing a single channel, counting toward a quota and
-- cleaning up legacy duplicates all stay ordinary queries.
--
-- last_seen_at is the incremental cursor. The weekly build asks each channel for
-- uploads newer than it, which is what "only what went up this week" means.
--
-- Verified against the live API before writing this (channels.list?forHandle):
--   @nomadcoders -> UCUpJs89fSBXNolQGOYKn0YQ, uploads UUUpJs89fSBXNolQGOYKn0YQ
-- channel_id stores the UC… id; the uploads playlist comes back from the same
-- call and is stored too, so the build never has to guess it from a convention.
--
-- Rollback: DROP TABLE public.curation_channels;

CREATE TABLE IF NOT EXISTS public.curation_channels (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES public.curation_subscriptions(id) ON DELETE CASCADE,
  channel_id      varchar(30)  NOT NULL,
  uploads_playlist_id varchar(34),
  channel_title   text,
  thumbnail_url   text,
  -- 'picked' = chosen from the user's YouTube subscriptions
  -- 'manual' = pasted URL or @handle (works without connecting YouTube)
  added_via       varchar(8) NOT NULL DEFAULT 'picked',
  last_seen_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_curation_channels_sub_channel
  ON public.curation_channels (subscription_id, channel_id);
CREATE INDEX IF NOT EXISTS idx_curation_channels_subscription_id
  ON public.curation_channels (subscription_id);

ALTER TABLE public.curation_channels ENABLE ROW LEVEL SECURITY;

COMMENT ON COLUMN public.curation_channels.uploads_playlist_id IS
  'From channels.list contentDetails.relatedPlaylists.uploads — stored so the weekly build never derives it from the UC->UU convention.';

NOTIFY pgrst, 'reload schema';
