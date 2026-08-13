/**
 * Cross-process invalidation for the YouTube response cache.
 *
 * clearYouTubeCache() removes entries from the process that runs it. With one
 * container that is the whole cache. With two, a user who disconnects YouTube
 * clears one replica while the others keep serving their subscriptions and
 * playlists until the 6-hour TTL runs out — data served for an account that
 * revoked access, not merely stale data.
 *
 * When on, invalidation is published to youtube_cache_epochs and every
 * process treats an entry stored before that moment as a miss. The payloads
 * stay in memory: the cache exists to protect YouTube API quota, and moving
 * them into the database would trade a quota problem for a storage one.
 *
 * Default OFF. Unset keeps today's behaviour, so the flag alone rolls back.
 * Requires prisma/migrations/youtube/001_youtube_cache_epochs.sql; a failed
 * query degrades to TTL-only expiry rather than erroring.
 */
export function isYouTubeCacheSharedInvalidation(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env['YOUTUBE_CACHE_SHARED_INVALIDATION'] ?? '')
    .trim()
    .toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}
