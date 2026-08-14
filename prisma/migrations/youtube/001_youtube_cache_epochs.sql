-- Cross-process invalidation for the YouTube response cache (2026-08-14).
--
-- The cache itself stays in process memory: it exists to protect YouTube API
-- quota (100 units per subscriptions call), and moving the payloads into the
-- database would trade a quota problem for a storage one.
--
-- What cannot stay in memory is the invalidation. clearYouTubeCache() deletes
-- the calling process's entries only, so after a user disconnects YouTube,
-- every other replica keeps serving that account's subscriptions and
-- playlists until the 6-hour TTL expires. That is not staleness, it is data
-- being served for an account that revoked access.
--
-- One row per user holds the moment their cache was invalidated. A cached
-- entry older than that row is treated as a miss, whichever process holds it.
--
-- prisma db push silent-fails on Supabase — apply manually to local AND prod,
-- verify with \d youtube_cache_epochs.
-- Idempotent (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS youtube_cache_epochs (
  user_id        uuid PRIMARY KEY,
  invalidated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE youtube_cache_epochs ENABLE ROW LEVEL SECURITY;
