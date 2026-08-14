/**
 * refresh-metadata core logic (CP512) — refresh active pool rows via videos.list,
 * with an empty-title integrity guard and retire-on-missing. Pure over injected
 * deps (DB + fetcher + clock), no real DB / YouTube key.
 */
import {
  refreshActivePoolMetadataCore,
  type RefreshDeps,
} from '@/modules/video-pool/refresh-metadata';
import type { YouTubeVideoFullMetadata } from '@/skills/plugins/video-discover/v2/youtube-client';

function makeDeps(
  candidateIds: string[],
  items: YouTubeVideoFullMetadata[]
): { deps: RefreshDeps; updated: Record<string, unknown>[]; retiredIds: string[][] } {
  const updated: Record<string, unknown>[] = [];
  const retiredIds: string[][] = [];
  const deps: RefreshDeps = {
    db: {
      $queryRawUnsafe: async () => candidateIds.map((video_id) => ({ video_id })) as never,
      $executeRawUnsafe: async (_q: string, ids: unknown) => {
        retiredIds.push(ids as string[]);
        return (ids as string[]).length;
      },
      video_pool: {
        update: async (args) => {
          updated.push({ video_id: args.where.video_id, ...args.data });
          return null;
        },
      },
    },
    fetchMetadata: async () => items,
    now: new Date('2026-07-09T00:00:00Z'),
    limit: 500,
    afterDays: 20,
  };
  return { deps, updated, retiredIds };
}

const meta = (id: string, title: string | undefined): YouTubeVideoFullMetadata => ({
  id,
  snippet: { title, channelTitle: 'ch', publishedAt: '2026-01-01T00:00:00Z' },
  statistics: { viewCount: '100', likeCount: '5' },
  contentDetails: { duration: 'PT5M' },
});

describe('refreshActivePoolMetadataCore', () => {
  it('refreshes rows with a title and writes refreshed_at', async () => {
    const { deps, updated } = makeDeps(['a', 'b'], [meta('a', 'Title A'), meta('b', 'Title B')]);
    const res = await refreshActivePoolMetadataCore(deps);
    expect(res).toEqual({ candidates: 2, refreshed: 2, retired: 0 });
    expect(updated.map((u) => u['title'])).toEqual(['Title A', 'Title B']);
    expect(updated[0]!['refreshed_at']).toBeInstanceOf(Date);
  });

  it('never writes an empty/whitespace title (integrity guard)', async () => {
    const { deps, updated } = makeDeps(['a', 'b'], [meta('a', ''), meta('b', '   ')]);
    const res = await refreshActivePoolMetadataCore(deps);
    expect(res.refreshed).toBe(0);
    expect(updated).toHaveLength(0);
  });

  it('retires candidates the API did not return (deleted/private)', async () => {
    // Only 'a' comes back; 'b' + 'c' are missing → retired.
    const { deps, retiredIds } = makeDeps(['a', 'b', 'c'], [meta('a', 'Title A')]);
    const res = await refreshActivePoolMetadataCore(deps);
    expect(res.refreshed).toBe(1);
    expect(res.retired).toBe(2);
    expect(retiredIds[0]!.sort()).toEqual(['b', 'c']);
  });

  it('no candidates → no-op', async () => {
    const { deps } = makeDeps([], []);
    const res = await refreshActivePoolMetadataCore(deps);
    expect(res).toEqual({ candidates: 0, refreshed: 0, retired: 0 });
  });
});
