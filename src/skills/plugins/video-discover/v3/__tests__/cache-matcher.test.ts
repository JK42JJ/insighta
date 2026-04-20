import { groupByCell, type CachedMatch } from '../cache-matcher';

function m(cellIndex: number, videoId: string, score: number): CachedMatch {
  return {
    videoId,
    title: `video ${videoId}`,
    description: null,
    channelName: null,
    channelId: null,
    thumbnail: null,
    viewCount: null,
    likeCount: null,
    durationSec: null,
    publishedAt: null,
    cellIndex,
    score,
  };
}

describe('groupByCell', () => {
  it('initializes 8 empty buckets', () => {
    const out = groupByCell([], 8);
    expect(out.size).toBe(8);
    for (let i = 0; i < 8; i++) {
      expect(out.get(i)).toEqual([]);
    }
  });

  it('distributes matches by cellIndex', () => {
    const matches = [m(0, 'a', 0.9), m(0, 'b', 0.8), m(3, 'c', 0.7)];
    const out = groupByCell(matches, 8);
    expect(out.get(0)).toHaveLength(2);
    expect(out.get(0)![0]!.videoId).toBe('a');
    expect(out.get(3)).toHaveLength(1);
    expect(out.get(3)![0]!.videoId).toBe('c');
    expect(out.get(7)).toEqual([]);
  });

  it('drops matches whose cellIndex is out of range', () => {
    const out = groupByCell([m(-1, 'a', 0.9), m(8, 'b', 0.8), m(2, 'c', 0.7)], 8);
    const total = [...out.values()].reduce((sum, arr) => sum + arr.length, 0);
    expect(total).toBe(1);
    expect(out.get(2)![0]!.videoId).toBe('c');
  });
});
