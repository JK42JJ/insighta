import { describe, expect, it } from 'vitest';

import { agoLabel, toFeedCard } from '@/features/morning-feed/feed-format';

/* Found 2026-11-25 on stg: every video of the day's briefs read 'NaN개월 전' with an empty picture. */
const card = {
  video_id: 'abcdefghijk',
  title: 't',
  channel: 'c',
  published_at: '',
  duration: 0,
  view_count: null,
  thumbnail_url: null,
  cell: 'x',
  focus: [],
  why: '',
} as Parameters<typeof toFeedCard>[0];

describe('a brief video that is not in the video pool', () => {
  it('has no age, and the YouTube thumbnail', () => {
    expect(agoLabel('')).toEqual({ text: '', fresh: false });
    const c = toFeedCard(card, ['p']);
    expect(c.ago).toBe('');
    expect(c.fresh).toBe(false);
    expect(c.thumbUrl).toBe('https://i.ytimg.com/vi/abcdefghijk/mqdefault.jpg');
    expect(JSON.stringify(c)).not.toContain('NaN');
  });

  it('a video in the pool keeps its own date and picture', () => {
    const now = new Date('2026-11-25T00:00:00Z');
    const c = toFeedCard(
      {
        ...card,
        published_at: '2026-11-22T00:00:00Z',
        thumbnail_url: 'https://i.ytimg.com/vi/z/own.jpg',
      },
      ['p'],
      now
    );
    expect(c.ago).toBe('3일 전');
    expect(c.thumbUrl).toBe('https://i.ytimg.com/vi/z/own.jpg');
  });
});
