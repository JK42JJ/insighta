/**
 * v3 language post-filter — unit tests
 *
 * Verifies that Tier-2 YouTube candidates are dropped when their title
 * language does not match the mandala language. YouTube's
 * `relevanceLanguage` parameter is a ranking hint, not a hard filter,
 * so Korean-titled videos can leak into English mandalas and
 * Latin-only-titled videos can leak into Korean mandalas.
 *
 * These tests exercise the filter logic directly (the regex predicate)
 * and via the YouTubeProvider.match() integration path.
 */

// ─── Logger mock ──────────────────────────────────────────────────────────────
const noopFn = jest.fn();
interface NoopLogger {
  info: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
  debug: jest.Mock;
  child: () => NoopLogger;
}
const noopLogger: NoopLogger = {
  info: noopFn,
  warn: noopFn,
  error: noopFn,
  debug: noopFn,
  child: (): NoopLogger => noopLogger,
};
jest.mock('@/utils/logger', () => ({ logger: noopLogger }));

// ─── v3 config — minimal stub ─────────────────────────────────────────────────
jest.mock('@/skills/plugins/video-discover/v3/config', () => ({
  v3Config: {
    maxQueries: 3,
    publishedAfterDays: 0,
    youtubeSearchTimeoutMs: 5000,
  },
}));

// ─── keyword-builder — return one fixed query ─────────────────────────────────
jest.mock('@/skills/plugins/video-discover/v2/keyword-builder', () => ({
  buildRuleBasedQueriesSync: jest.fn().mockReturnValue([{ query: 'test query', cellIndex: 0 }]),
}));

// ─── tracing — no-op ──────────────────────────────────────────────────────────
jest.mock('@/modules/discover-tracing', () => ({
  recordTrace: jest.fn(),
}));

// ─── YouTube client — mocked at module level ──────────────────────────────────
const mockSearchVideos = jest.fn();
const mockVideosBatch = jest.fn();
jest.mock('@/skills/plugins/video-discover/v2/youtube-client', () => ({
  searchVideos: mockSearchVideos,
  videosBatch: mockVideosBatch,
  parseIsoDuration: jest.requireActual('@/skills/plugins/video-discover/v2/youtube-client')
    .parseIsoDuration,
  isShortsByDuration: jest.requireActual('@/skills/plugins/video-discover/v2/youtube-client')
    .isShortsByDuration,
  titleIndicatesShorts: jest.requireActual('@/skills/plugins/video-discover/v2/youtube-client')
    .titleIndicatesShorts,
  titleHitsBlocklist: jest.requireActual('@/skills/plugins/video-discover/v2/youtube-client')
    .titleHitsBlocklist,
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────
import { YouTubeProvider } from '../v3/providers/youtube-provider';
import type { MatchRequest } from '../v3/providers/types';

// ─── Unit tests: language predicate ──────────────────────────────────────────

describe('hasKoreanTitle predicate (inline)', () => {
  const hasKorean = (text: string): boolean => /[가-힣]/.test(text);

  test('returns true for titles containing Hangul', () => {
    expect(hasKorean('기타 코드 배우기')).toBe(true);
    expect(hasKorean('Learn 기타 Chords')).toBe(true);
    expect(hasKorean('공부 방법')).toBe(true);
  });

  test('returns false for purely Latin/ASCII titles', () => {
    expect(hasKorean('Learn Guitar Chords Beginner')).toBe(false);
    expect(hasKorean('How to play A minor chord')).toBe(false);
    expect(hasKorean('')).toBe(false);
    expect(hasKorean('KBO MLB draft highlights 2024')).toBe(false);
  });
});

// ─── Integration: YouTubeProvider.match() language post-filter ───────────────

/** Build a minimal MatchRequest for YouTubeProvider.match(). */
function makeRequest(language: 'en' | 'ko'): MatchRequest {
  return {
    mandalaId: 'test-mandala',
    userId: 'test-user',
    centerGoal: 'Learn guitar',
    cells: [{ cellIndex: 0, subGoal: 'Chords', keywords: ['guitar chords', 'beginner'] }],
    focusTags: [],
    language,
    budget: 20,
    excludeVideoIds: new Set(),
  };
}

/** Build a fake search item with the given videoId and title. */
function makeSearchItem(
  videoId: string,
  title: string
): {
  id: { videoId: string };
  snippet: {
    title: string;
    description: string;
    channelTitle: string;
    channelId: string;
    publishedAt: string;
    thumbnails: { high: { url: string } };
  };
} {
  return {
    id: { videoId },
    snippet: {
      title,
      description: 'test description',
      channelTitle: 'Test Channel',
      channelId: 'channel-1',
      publishedAt: '2024-01-01T00:00:00Z',
      thumbnails: { high: { url: `https://img/${videoId}.jpg` } },
    },
  };
}

/** Build a fake stats item with a safe long duration (default 5 min). */
function makeStatsItem(
  videoId: string,
  durationIso = 'PT5M'
): {
  id: string;
  statistics: { viewCount: string; likeCount: string };
  contentDetails: { duration: string };
} {
  return {
    id: videoId,
    statistics: { viewCount: '50000', likeCount: '1000' },
    contentDetails: { duration: durationIso },
  };
}

describe('YouTubeProvider.match() — language post-filter', () => {
  let provider: YouTubeProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new YouTubeProvider(['test-key']);
  });

  test('en mandala: drops a Korean-titled candidate, keeps English-titled one', async () => {
    const koreanVideo = makeSearchItem('vid-ko', '기타 코드 배우기 초보자');
    const englishVideo = makeSearchItem('vid-en', 'Guitar Chords for Beginners');

    mockSearchVideos.mockResolvedValueOnce([koreanVideo, englishVideo]);
    mockVideosBatch.mockResolvedValueOnce([makeStatsItem('vid-ko'), makeStatsItem('vid-en')]);

    const result = await provider.match(makeRequest('en'));

    expect(result.candidates.map((c) => c.videoId)).toEqual(['vid-en']);
    expect(result.candidates).toHaveLength(1);
  });

  test('ko mandala: drops a Latin-only-titled candidate, keeps Korean-titled one', async () => {
    const koreanVideo = makeSearchItem('vid-ko', '기타 코드 배우기 초보자');
    const englishVideo = makeSearchItem('vid-en', 'Guitar Chords for Beginners');

    mockSearchVideos.mockResolvedValueOnce([koreanVideo, englishVideo]);
    mockVideosBatch.mockResolvedValueOnce([makeStatsItem('vid-ko'), makeStatsItem('vid-en')]);

    const result = await provider.match(makeRequest('ko'));

    expect(result.candidates.map((c) => c.videoId)).toEqual(['vid-ko']);
    expect(result.candidates).toHaveLength(1);
  });

  test('en mandala: matching-language (English-title) candidate survives', async () => {
    const englishVideo = makeSearchItem('vid-en', 'Beginner Guitar Lesson Part 1');

    mockSearchVideos.mockResolvedValueOnce([englishVideo]);
    mockVideosBatch.mockResolvedValueOnce([makeStatsItem('vid-en')]);

    const result = await provider.match(makeRequest('en'));

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.videoId).toBe('vid-en');
  });

  test('ko mandala: matching-language (Korean-title) candidate survives', async () => {
    const koreanVideo = makeSearchItem('vid-ko', '기초 기타 강의 1편');

    mockSearchVideos.mockResolvedValueOnce([koreanVideo]);
    mockVideosBatch.mockResolvedValueOnce([makeStatsItem('vid-ko')]);

    const result = await provider.match(makeRequest('ko'));

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.videoId).toBe('vid-ko');
  });

  test('shorts (PT1M = 60s) are dropped before the language filter', async () => {
    // A Korean-titled short in a ko mandala — dropped by duration (60 <= 75).
    const shortKorean = makeSearchItem('vid-short-ko', '기타 코드 1분 강의');

    mockSearchVideos.mockResolvedValueOnce([shortKorean]);
    // PT1M = 60s → isShortsByDuration(60) = true (60 <= SHORTS_MAX_DURATION_SEC=75)
    mockVideosBatch.mockResolvedValueOnce([makeStatsItem('vid-short-ko', 'PT1M')]);

    const result = await provider.match(makeRequest('ko'));

    expect(result.candidates).toHaveLength(0);
  });
});
