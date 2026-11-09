import { titleShape } from '@/modules/measurement/title-shape';
import {
  countChapters,
  computeReactionFeatures,
  computeVideoFeatures,
  parseIsoDurationSec,
  safeRatio,
} from '@/modules/measurement/features';
import {
  commentSignalsForVideo,
  countCommentSignals,
  fetchTopComments,
} from '@/modules/measurement/comment-signals';
import {
  channelFeaturesForVideo,
  computeChannelFeatures,
  median,
  shortsRatio,
  uploadCadenceDays,
  viewsMultiple,
} from '@/modules/measurement/channel-features';
import { toRow } from '@/modules/measurement/writer';
import { SHORT_MAX_DURATION_SEC } from '@/modules/video-pool/is-short';
import type { FetchFn } from '@/modules/measurement/types';

const NOW = new Date('2026-06-11T00:00:00Z');
const DAY_MS = 86_400_000;
const daysAgo = (n: number): string => new Date(NOW.getTime() - n * DAY_MS).toISOString();

function mockFetch(routes: Array<[string, number, unknown]>): { fn: FetchFn; urls: string[] } {
  const urls: string[] = [];
  const fn: FetchFn = async (url) => {
    urls.push(url);
    const hit = routes.find(([frag]) => url.includes(frag));
    const [, status, body] = hit ?? ['', 404, {}];
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  return { fn, urls };
}

describe('titleShape', () => {
  it.each([
    ['파이썬 5분 완성', { has_number: true }],
    ['파이썬 기초 강의', { has_number: false, has_howto: true }],
    ['How to learn Python', { has_howto: true }],
    ['충격 이거 모르면 손해', { has_exaggeration: true }],
    ['평범한 제목', { has_number: false, has_howto: false, has_exaggeration: false }],
    ['[강의] 파이썬', { has_bracket: true }],
    ['파이썬 (입문)', { has_bracket: true }],
    ['파이썬 🔥🔥 꿀팁 😀', { emoji_count: 3 }],
    ['', { emoji_count: 0, has_bracket: false }],
  ])('%s', (title, expected) => {
    expect(titleShape(title)).toMatchObject(expected);
  });
  it('handles null', () => {
    expect(titleShape(null).emoji_count).toBe(0);
  });
});

describe('countChapters', () => {
  it('counts m:ss, mm:ss and h:mm:ss lines', () => {
    const d = ['intro', '0:00 시작', '12:34 본론', '1:02:03 마무리', '- 5:00 보너스'].join('\n');
    expect(countChapters(d)).toBe(4);
  });
  it('ignores inline timestamps and empty', () => {
    expect(countChapters('see 1:00 here')).toBe(0);
    expect(countChapters('')).toBe(0);
    expect(countChapters(null)).toBe(0);
  });
});

describe('parseIsoDurationSec', () => {
  it.each([
    ['PT1H2M3S', 3723],
    ['PT45S', 45],
    ['PT10M', 600],
    ['P0D', 0],
  ])('%s', (iso, sec) => expect(parseIsoDurationSec(iso)).toBe(sec));
  it('null on junk', () => {
    expect(parseIsoDurationSec('abc')).toBeNull();
    expect(parseIsoDurationSec(undefined)).toBeNull();
  });
});

describe('reaction features', () => {
  it('views_per_day uses min age of 1 day', () => {
    const r = computeReactionFeatures(
      { snippet: { publishedAt: daysAgo(0) }, statistics: { viewCount: '1000' } },
      NOW
    );
    expect(r.views_per_day).toBe(1000);
  });
  it('views_per_day divides by age when older', () => {
    const r = computeReactionFeatures(
      {
        snippet: { publishedAt: daysAgo(10) },
        statistics: { viewCount: '1000', likeCount: '50', commentCount: '5' },
      },
      NOW
    );
    expect(r.views_per_day).toBe(100);
    expect(r.like_per_view).toBeCloseTo(0.05);
    expect(r.comment_per_view).toBeCloseTo(0.005);
  });
  it('zero views gives null ratios', () => {
    const r = computeReactionFeatures(
      { snippet: { publishedAt: daysAgo(3) }, statistics: { viewCount: '0', likeCount: '0' } },
      NOW
    );
    expect(r.like_per_view).toBeNull();
    expect(r.comment_per_view).toBeNull();
    expect(r.views_per_day).toBe(0);
  });
  it('safeRatio', () => {
    expect(safeRatio(1, 0)).toBeNull();
    expect(safeRatio(null, 5)).toBeNull();
    expect(safeRatio(1, 4)).toBe(0.25);
  });
});

describe('computeVideoFeatures', () => {
  it('assembles video block', () => {
    const v = computeVideoFeatures(
      {
        snippet: { title: '3가지 방법', description: '0:00 a\n1:00 b', publishedAt: daysAgo(7) },
        contentDetails: { duration: 'PT10M', caption: 'true', definition: 'hd' },
      },
      NOW
    );
    expect(v).toMatchObject({
      age_days: 7,
      duration_sec: 600,
      chapter_count: 2,
      has_caption: true,
      definition: 'hd',
      description_length: 13,
    });
    expect(v.title_shape.has_number).toBe(true);
  });
  it('caption false when not the string true', () => {
    expect(computeVideoFeatures({ contentDetails: { caption: 'false' } }, NOW).has_caption).toBe(
      false
    );
  });
});

describe('channel calculators', () => {
  it('median', () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
  it('uploadCadenceDays is median gap', () => {
    // gaps: 1, 1, 8 -> median 1
    expect(uploadCadenceDays([daysAgo(0), daysAgo(1), daysAgo(2), daysAgo(10)])).toBeCloseTo(1);
    expect(uploadCadenceDays([daysAgo(0)])).toBeNull();
  });
  it('shortsRatio threshold is <= SHORT_MAX_DURATION_SEC', () => {
    const t = SHORT_MAX_DURATION_SEC;
    expect(shortsRatio([t, t + 1, 30, 600])).toBe(0.5);
    expect(shortsRatio([null, null])).toBeNull();
  });
  it('viewsMultiple', () => {
    expect(viewsMultiple(300, [100, 100, 100])).toBe(3);
    expect(viewsMultiple(300, [])).toBeNull();
    expect(viewsMultiple(300, [0, 0])).toBeNull();
  });
  it('computeChannelFeatures hides subscribers and records threshold', () => {
    const f = computeChannelFeatures(
      {
        subscriberCount: 1000,
        hiddenSubscriberCount: true,
        channelPublishedAt: daysAgo(100),
        videoCount: 40,
        recentPublishedAt: [daysAgo(0), daysAgo(2)],
        recentDurationsSec: [60, 600],
        recentViews: [10, 30],
        videoViews: 40,
      },
      NOW
    );
    expect(f.subscriber_count).toBeNull();
    expect(f.channel_age_days).toBe(100);
    expect(f.shorts_threshold_sec).toBe(SHORT_MAX_DURATION_SEC);
    expect(f.shorts_ratio_last50).toBe(0.5);
    expect(f.views_multiple_vs_channel_median).toBe(2);
  });
});

describe('channelFeaturesForVideo (mock fetch)', () => {
  it('fetches 3 endpoints and counts units', async () => {
    const { fn, urls } = mockFetch([
      [
        '/channels?',
        200,
        {
          items: [
            {
              snippet: { publishedAt: daysAgo(50) },
              contentDetails: { relatedPlaylists: { uploads: 'UU1' } },
              statistics: { subscriberCount: '500', videoCount: '12' },
            },
          ],
        },
      ],
      [
        '/playlistItems?',
        200,
        { items: [{ contentDetails: { videoId: 'a' } }, { contentDetails: { videoId: 'b' } }] },
      ],
      [
        '/videos?',
        200,
        {
          items: [
            {
              snippet: { publishedAt: daysAgo(0) },
              contentDetails: { duration: 'PT30S' },
              statistics: { viewCount: '10' },
            },
            {
              snippet: { publishedAt: daysAgo(4) },
              contentDetails: { duration: 'PT10M' },
              statistics: { viewCount: '30' },
            },
          ],
        },
      ],
    ]);
    const r = await channelFeaturesForVideo('C1', 80, 'KEY', fn, NOW);
    expect(r.units).toEqual({ channels: 1, playlistItems: 1, videos: 1 });
    expect(urls).toHaveLength(3);
    expect(r.features).toMatchObject({
      subscriber_count: 500,
      channel_video_count: 12,
      upload_cadence_days: 4,
      shorts_ratio_last50: 0.5,
      views_multiple_vs_channel_median: 4,
    });
  });
  it('null features when channel missing', async () => {
    const { fn } = mockFetch([['/channels?', 200, { items: [] }]]);
    const r = await channelFeaturesForVideo('C1', 1, 'KEY', fn, NOW);
    expect(r.features).toBeNull();
    expect(r.units).toEqual({ channels: 1, playlistItems: 0, videos: 0 });
  });
});

describe('comment signals', () => {
  const words = { positive: ['도움', '감사'], negative: ['광고', '낚시'] };

  it('counts comments with hits and returns counts only', () => {
    const texts = ['정말 도움 됐어요 감사합니다', '광고 너무 많음', '그냥 그럼', '낚시 영상'];
    const out = countCommentSignals(texts, words);
    expect(out).toEqual({ positive_count: 1, negative_count: 2, sampled: 4 });
    expect(Object.keys(out).sort()).toEqual(['negative_count', 'positive_count', 'sampled']);
    expect(JSON.stringify(out)).not.toContain('광고 너무');
  });

  it('fetchTopComments builds the relevance request and returns texts', async () => {
    const { fn, urls } = mockFetch([
      [
        'commentThreads',
        200,
        { items: [{ snippet: { topLevelComment: { snippet: { textOriginal: '도움 감사' } } } }] },
      ],
    ]);
    const r = await fetchTopComments('vid1', 'KEY', fn);
    expect(r).toEqual({ texts: ['도움 감사'], disabled: false });
    expect(urls[0]).toContain('order=relevance');
    expect(urls[0]).toContain('maxResults=20');
    expect(urls[0]).toContain('textFormat=plainText');
  });

  it('403 commentsDisabled sets disabled', async () => {
    const { fn } = mockFetch([
      ['commentThreads', 403, { error: { errors: [{ reason: 'commentsDisabled' }] } }],
    ]);
    expect(await fetchTopComments('v', 'K', fn)).toEqual({ texts: [], disabled: true });
  });

  it('other errors are not disabled', async () => {
    const { fn } = mockFetch([['commentThreads', 500, {}]]);
    expect(await fetchTopComments('v', 'K', fn)).toEqual({ texts: [], disabled: false });
  });

  it('commentSignalsForVideo result contains no text and never logs it', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      jest.spyOn(console, m).mockImplementation(() => undefined)
    );
    const { fn } = mockFetch([
      [
        'commentThreads',
        200,
        {
          items: [{ snippet: { topLevelComment: { snippet: { textOriginal: '비밀댓글 도움' } } } }],
        },
      ],
    ]);
    const out = await commentSignalsForVideo('v', 'K', fn, words);
    expect(Object.keys(out).sort()).toEqual([
      'disabled',
      'negative_count',
      'positive_count',
      'sampled',
    ]);
    expect(JSON.stringify(out)).not.toContain('비밀댓글');
    for (const s of spies) {
      expect(JSON.stringify(s.mock.calls)).not.toContain('비밀댓글');
      s.mockRestore();
    }
  });
});

describe('writer.toRow', () => {
  it('maps record to columns and caps video id', () => {
    const row = toRow({
      runId: 'r1',
      branch: 'track1',
      videoId: 'x'.repeat(30),
      discoveryPaths: 2,
      relevanceScore: 0.5,
    });
    expect(row['run_id']).toBe('r1');
    expect((row['video_id'] as string).length).toBe(20);
    expect(row['measurement_version']).toBe(1);
    expect(row['discovery_paths']).toBe(2);
  });
});
