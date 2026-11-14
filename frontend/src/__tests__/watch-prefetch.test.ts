import { describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  fetchMorningPagesHome: vi.fn(),
  fetchWatchToday: vi.fn(),
  fetchMorningFeedHistory: vi.fn(),
}));
vi.mock('@/features/morning-cards/api', () => api);

import { takeWatchStart } from '@/features/morning-feed/watch-prefetch';

describe('watch start for a participant (decision 2026-11-14 user test)', () => {
  it('a failed brief read is tried again; the experiment routes are never asked', async () => {
    const home = {
      current: null,
      lastDomain: null,
      others: [],
      experiment: false,
      cells: [{ label: '기술/개발' }],
    };
    api.fetchMorningPagesHome
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(home);
    const [today, history, pages] = await takeWatchStart();
    expect(today).toBeNull();
    expect(history).toEqual([]);
    expect(pages).toBe(home);
    expect(api.fetchMorningPagesHome).toHaveBeenCalledTimes(2);
    expect(api.fetchWatchToday).not.toHaveBeenCalled();
    expect(api.fetchMorningFeedHistory).not.toHaveBeenCalled();
  });

  it('the main account (experiment) also reads today and its history', async () => {
    api.fetchMorningPagesHome.mockResolvedValueOnce({
      current: null,
      lastDomain: null,
      others: [],
      experiment: true,
      cells: [],
    });
    api.fetchWatchToday.mockResolvedValueOnce({
      day: '2026-11-14',
      daily: 5,
      cells: [],
      today: {},
    });
    api.fetchMorningFeedHistory.mockResolvedValueOnce([]);
    const [today] = await takeWatchStart();
    expect(today).not.toBeNull();
  });
});
