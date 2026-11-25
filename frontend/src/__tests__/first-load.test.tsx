import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  keepTrying,
  loadChunk,
  RETRY_DELAYS_MS,
  retryDelay,
} from '@/features/morning-feed/first-load';

/* Found 2026-11-25 (a first-time participant): one failed flag check left a blank screen for good. */

const status = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('@/features/morning-cards/api', async (orig) => ({
  ...(await orig<typeof import('@/features/morning-cards/api')>()),
  fetchMorningCardsStatus: () => status.fn(),
}));
vi.mock('@/features/morning-feed/watch-prefetch', () => ({ prefetchWatchStart: () => undefined }));
vi.mock('@/features/morning-feed/MorningWatchLive', () => ({
  MorningWatchLive: () => <div data-testid="live" />,
}));

import { MorningFeedRoute } from '@/features/morning-feed/MorningFeedRoute';

beforeEach(() => {
  vi.useFakeTimers();
  status.fn.mockReset();
  sessionStorage.clear();
});
afterEach(() => vi.useRealTimers());
const pass = (ms: number): Promise<void> =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

describe('first load', () => {
  it('a failed flag check keeps the logo and is tried again until it answers', async () => {
    status.fn
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ enabled: true });
    render(
      <MemoryRouter initialEntries={['/morning-cards?view=watch']}>
        <MorningFeedRoute />
      </MemoryRouter>
    );
    await pass(10);
    expect(screen.getByTestId('mf-w-boot')).toBeTruthy();
    await pass(RETRY_DELAYS_MS[0]! + RETRY_DELAYS_MS[1]! + 50);
    expect(status.fn).toHaveBeenCalledTimes(3);
    await pass(50);
    expect(screen.getByTestId('live')).toBeTruthy();
  });

  it('the connection coming back is tried at once; waits grow, then stay', async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue('ok');
    const p = keepTrying(read, () => true);
    await vi.advanceTimersByTimeAsync(10);
    window.dispatchEvent(new Event('online'));
    await expect(p).resolves.toBe('ok');
    expect(retryDelay(1)).toBe(RETRY_DELAYS_MS[0]);
    expect(retryDelay(99)).toBe(RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]);
  });

  it('stops when the screen is gone', async () => {
    let alive = true;
    const read = vi.fn().mockRejectedValue(new Error('x'));
    void keepTrying(read, () => alive);
    await vi.advanceTimersByTimeAsync(10);
    alive = false;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('a chunk that does not load: three tries, one reload, then the error', async () => {
    const load = vi.fn().mockRejectedValue(new Error('404'));
    const reload = vi.fn();
    void loadChunk(load, reload);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(load).toHaveBeenCalledTimes(3);
    expect(reload).toHaveBeenCalledTimes(1);
    const again = loadChunk(load, reload).catch((e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(20_000);
    await expect(again).resolves.toBe('404');
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
