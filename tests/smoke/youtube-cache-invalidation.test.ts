import { isYouTubeCacheSharedInvalidation } from '../../src/config/youtube-cache';
import { readFileSync } from 'fs';
import { join, resolve } from 'path';

const ROOT = resolve(__dirname, '..', '..');

/**
 * clearYouTubeCache() empties the cache of the process that runs it. With two
 * api replicas, a user who disconnects YouTube clears one of them while the
 * others keep serving that account's subscriptions and playlists for up to
 * six hours. That is not staleness — it is data served for an account that
 * revoked access.
 */
describe('shared cache invalidation flag', () => {
  it('defaults off, keeping the current single-process behaviour', () => {
    expect(isYouTubeCacheSharedInvalidation({})).toBe(false);
  });

  it.each(['true', 'TRUE', '1', 'yes'])('publishes invalidation on %s', (v) => {
    expect(isYouTubeCacheSharedInvalidation({ YOUTUBE_CACHE_SHARED_INVALIDATION: v })).toBe(true);
  });

  it.each(['false', '0', 'no', '', 'shared'])('stays local for %s', (v) => {
    expect(isYouTubeCacheSharedInvalidation({ YOUTUBE_CACHE_SHARED_INVALIDATION: v })).toBe(false);
  });
});

describe('invalidation is wired end to end', () => {
  it('publishes before responding, not after', () => {
    const route = readFileSync(join(ROOT, 'src/api/routes/youtube.ts'), 'utf8');
    // Unawaited, the endpoint answers "ok" while the invalidation is still
    // in flight, so a caller can immediately read a cache it was told is clear.
    expect(route).toMatch(/await clearYouTubeCache\(/);
  });

  it('checks the epoch against when the entry was stored, not just that one exists', () => {
    const api = readFileSync(join(ROOT, 'src/modules/youtube/api.ts'), 'utf8');
    // Invalidating unconditionally would also drop entries cached after the
    // disconnect, turning every subsequent request into a quota call.
    expect(api).toMatch(/invalidated_at\.getTime\(\) > storedAt/);
    expect(api).toMatch(/storedAt: now/);
  });

  it('ships the table as raw SQL and in the deploy allowlist', () => {
    const ddl = 'prisma/migrations/youtube/001_youtube_cache_epochs.sql';
    expect(readFileSync(join(ROOT, ddl), 'utf8')).toMatch(
      /CREATE TABLE IF NOT EXISTS youtube_cache_epochs/
    );
    expect(readFileSync(join(ROOT, 'scripts/apply-custom-sql.sh'), 'utf8')).toContain(ddl);
    expect(readFileSync(join(ROOT, 'prisma/schema.prisma'), 'utf8')).toMatch(
      /model youtube_cache_epochs/
    );
  });
});
