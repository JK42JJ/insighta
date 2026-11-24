import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/features/morning-cards/api', () => ({
  fetchMorningCardsStatus: () => Promise.resolve({ enabled: true }),
}));
vi.mock('@/features/morning-feed/MorningFeedLive', () => ({
  MorningFeedLive: () => <div data-testid="deck" />,
}));
vi.mock('@/features/morning-feed/MorningWatchLive', () => ({
  MorningWatchLive: () => <div data-testid="watch" />,
}));
const prefetch = vi.hoisted(() => vi.fn());
vi.mock('@/features/morning-feed/watch-prefetch', () => ({ prefetchWatchStart: prefetch }));

import { MorningFeedRoute } from '@/features/morning-feed/MorningFeedRoute';

describe('/morning-cards views (stg 2026-11-25)', () => {
  it.each([
    ['/morning-cards', 'watch'],
    ['/morning-cards?view=watch', 'watch'],
    ['/morning-cards?onboard=0', 'watch'],
    ['/morning-cards?view=deck', 'deck'],
    ['/morning-cards?view=deck&onboard=0', 'deck'],
  ])('%s -> %s', async (url, screenId) => {
    prefetch.mockClear();
    render(
      <MemoryRouter initialEntries={[url]}>
        <MorningFeedRoute />
      </MemoryRouter>
    );
    expect(await screen.findByTestId(screenId)).toBeTruthy();
    expect(screen.queryByTestId(screenId === 'deck' ? 'watch' : 'deck')).toBeNull();
    expect(prefetch).toHaveBeenCalledTimes(screenId === 'watch' ? 1 : 0);
  });
});
