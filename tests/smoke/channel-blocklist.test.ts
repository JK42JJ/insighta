/**
 * Channel blocklist (P0 scam-inflow 2026-07-03) — matching + cache contract.
 * The two seed scam channels shipped with channel_id NULL, so name matching
 * is load-bearing, not a fallback nicety.
 */

const mockFindMany = jest.fn();

jest.mock('@/modules/database/client', () => ({
  getPrismaClient: () => ({
    channel_blocklist: { findMany: mockFindMany },
  }),
}));

import {
  isChannelBlocked,
  filterBlockedChannels,
  resetChannelBlocklistCacheForTest,
} from '../../src/modules/moderation/channel-blocklist';

describe('channel-blocklist', () => {
  beforeEach(() => {
    resetChannelBlocklistCacheForTest();
    mockFindMany.mockReset();
    mockFindMany.mockResolvedValue([
      { channel_id: 'UC_scam', channel_name: null },
      { channel_id: null, channel_name: '체인분석가' },
    ]);
  });

  test('blocks by channel_id', async () => {
    expect(await isChannelBlocked('UC_scam', null)).toBe(true);
  });

  test('blocks by exact channel_name when id is absent (seed scam case)', async () => {
    expect(await isChannelBlocked(null, '체인분석가')).toBe(true);
  });

  test('passes unlisted channels; neither field = pass', async () => {
    expect(await isChannelBlocked('UC_ok', '정상채널')).toBe(false);
    expect(await isChannelBlocked(null, null)).toBe(false);
  });

  test('filterBlockedChannels drops blocked and counts them (one snapshot load)', async () => {
    const items = [
      { id: 1, ch: 'UC_scam', name: null as string | null },
      { id: 2, ch: null as string | null, name: '체인분석가' },
      { id: 3, ch: 'UC_ok', name: '정상채널' },
    ];
    const r = await filterBlockedChannels(items, (i) => ({
      channelId: i.ch,
      channelName: i.name,
    }));
    expect(r.kept.map((i) => i.id)).toEqual([3]);
    expect(r.blockedCount).toBe(2);
    expect(mockFindMany).toHaveBeenCalledTimes(1);
  });

  test('fail-open on DB error — discovery keeps serving with empty snapshot', async () => {
    mockFindMany.mockRejectedValueOnce(new Error('db down'));
    expect(await isChannelBlocked('UC_scam', null)).toBe(false);
  });
});
