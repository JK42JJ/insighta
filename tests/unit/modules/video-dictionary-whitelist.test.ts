jest.mock('@/utils/logger', () => ({
  logger: {
    child: () => ({
      debug: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
    }),
  },
}));

const mockGetClient = jest.fn();
jest.mock('@/modules/redis', () => ({
  getInsightaRedisClient: () => mockGetClient(),
}));

import {
  filterByWhitelist,
  getChannelWhitelist,
  resetWhitelistCacheForTesting,
  WHITELIST_CACHE_TTL_MS,
  WHITELIST_CHANNELS_KEY,
  type WhitelistGateSlot,
} from '../../../src/modules/video-dictionary/whitelist';

const slot = (videoId: string, channelId: string): WhitelistGateSlot => ({
  videoId,
  channelId,
});

const CID_A = 'UCaaaaaaaaaaaaaaaaaaaaaa';
const CID_B = 'UCbbbbbbbbbbbbbbbbbbbbbb';
const CID_C = 'UCcccccccccccccccccccccc';

beforeEach(() => {
  resetWhitelistCacheForTesting();
  mockGetClient.mockReset();
});

// ---------------------------------------------------------------------------
// getChannelWhitelist
// ---------------------------------------------------------------------------

describe('getChannelWhitelist', () => {
  test('returns empty set when redis client is null (fail-open)', async () => {
    mockGetClient.mockResolvedValue(null);
    const wl = await getChannelWhitelist();
    expect(wl.size).toBe(0);
  });

  test('returns SMEMBERS result as a Set', async () => {
    mockGetClient.mockResolvedValue({
      sMembers: jest.fn().mockResolvedValue([CID_A, CID_B]),
    });
    const wl = await getChannelWhitelist();
    expect(wl).toEqual(new Set([CID_A, CID_B]));
  });

  test('caches result within TTL window', async () => {
    const sMembers = jest.fn().mockResolvedValue([CID_A]);
    mockGetClient.mockResolvedValue({ sMembers });

    const now = 1_000_000;
    const first = await getChannelWhitelist(now);
    const second = await getChannelWhitelist(now + WHITELIST_CACHE_TTL_MS - 1);

    expect(first).toBe(second); // same Set reference
    expect(sMembers).toHaveBeenCalledTimes(1);
    expect(sMembers).toHaveBeenCalledWith(WHITELIST_CHANNELS_KEY);
  });

  test('refreshes after TTL expiry', async () => {
    const sMembers = jest.fn().mockResolvedValueOnce([CID_A]).mockResolvedValueOnce([CID_A, CID_B]);
    mockGetClient.mockResolvedValue({ sMembers });

    const now = 1_000_000;
    const first = await getChannelWhitelist(now);
    const second = await getChannelWhitelist(now + WHITELIST_CACHE_TTL_MS + 1);

    expect(first.size).toBe(1);
    expect(second.size).toBe(2);
    expect(sMembers).toHaveBeenCalledTimes(2);
  });

  test('returns empty set when SMEMBERS throws (fail-open)', async () => {
    mockGetClient.mockResolvedValue({
      sMembers: jest.fn().mockRejectedValue(new Error('WRONGPASS')),
    });
    const wl = await getChannelWhitelist();
    expect(wl.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// filterByWhitelist
// ---------------------------------------------------------------------------

describe('filterByWhitelist', () => {
  test('disabled → full passthrough with disabled trace reason', () => {
    const slots = [slot('v1', CID_A), slot('v2', CID_B)];
    const out = filterByWhitelist(slots, new Set([CID_A]), { enabled: false });
    expect(out.slots).toHaveLength(2);
    expect(out.trace.reason).toBe('disabled');
    expect(out.trace.keptCount).toBe(2);
    expect(out.trace.droppedCount).toBe(0);
  });

  test('empty slots → no-op empty_slots trace', () => {
    const out = filterByWhitelist([], new Set([CID_A]), { enabled: true });
    expect(out.slots).toEqual([]);
    expect(out.trace.reason).toBe('empty_slots');
    expect(out.trace.inputCount).toBe(0);
  });

  test('empty whitelist with default fallback → passthrough w/ inclusive reason', () => {
    const slots = [slot('v1', CID_A), slot('v2', CID_B)];
    const out = filterByWhitelist(slots, new Set(), { enabled: true });
    expect(out.slots).toHaveLength(2);
    expect(out.trace.reason).toBe('empty_whitelist_inclusive_fallback');
  });

  test('empty whitelist with fallback disabled → drop all', () => {
    const slots = [slot('v1', CID_A), slot('v2', CID_B)];
    const out = filterByWhitelist(slots, new Set(), {
      enabled: true,
      emptyWhitelistInclusiveFallback: false,
    });
    expect(out.slots).toEqual([]);
    expect(out.trace.reason).toBe('applied');
    expect(out.trace.droppedCount).toBe(2);
  });

  test('partial match — drops non-whitelisted channels', () => {
    const slots = [slot('v1', CID_A), slot('v2', CID_B), slot('v3', CID_C)];
    const out = filterByWhitelist(slots, new Set([CID_A, CID_C]), {
      enabled: true,
    });
    expect(out.slots.map((s) => s.videoId)).toEqual(['v1', 'v3']);
    expect(out.trace.reason).toBe('applied');
    expect(out.trace.keptCount).toBe(2);
    expect(out.trace.droppedCount).toBe(1);
  });

  test('all whitelisted — keeps everything', () => {
    const slots = [slot('v1', CID_A), slot('v2', CID_B)];
    const out = filterByWhitelist(slots, new Set([CID_A, CID_B]), {
      enabled: true,
    });
    expect(out.slots).toHaveLength(2);
    expect(out.trace.droppedCount).toBe(0);
  });

  test('none whitelisted — drops all', () => {
    const slots = [slot('v1', CID_A), slot('v2', CID_B)];
    const out = filterByWhitelist(slots, new Set([CID_C]), { enabled: true });
    expect(out.slots).toEqual([]);
    expect(out.trace.droppedCount).toBe(2);
  });

  test('preserves slot metadata beyond videoId/channelId', () => {
    interface RichSlot extends WhitelistGateSlot {
      score: number;
      cellIndex: number;
    }
    const slots: RichSlot[] = [
      { videoId: 'v1', channelId: CID_A, score: 0.9, cellIndex: 3 },
      { videoId: 'v2', channelId: CID_B, score: 0.4, cellIndex: 5 },
    ];
    const out = filterByWhitelist(slots, new Set([CID_A]), { enabled: true });
    expect(out.slots[0]).toMatchObject({ videoId: 'v1', score: 0.9, cellIndex: 3 });
  });
});
