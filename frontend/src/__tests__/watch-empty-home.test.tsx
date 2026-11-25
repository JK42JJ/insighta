import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MorningHomePages, MorningPage } from '@/features/morning-cards/api';

/*
 * Signed-in participant without today's brief (decision 2026-11-24 usability test): the home shows
 * the newest readable brief (the server picks it: newest seen date up to today, hidden pages and
 * cells left out) with its date; only when there is none, the empty-state text is drawn inside the
 * home's layout (top bar, date row), never as a bare screen.
 */

vi.mock('@/features/morning-feed/watch-home-fonts', () => ({
  ensureHomeFonts: () => undefined,
  waitHomeFonts: () => Promise.resolve('late'),
  FONT_WAIT_MS: 1500,
}));
vi.mock('@/features/auth/model/useAuth', () => ({
  useAuth: () => ({
    userName: '참여자',
    userEmail: 'p@example.com',
    userAvatar: null,
    signOut: () => Promise.resolve(),
  }),
}));
vi.mock('@/features/landing-intro', async (orig) => ({
  ...(await orig<typeof import('@/features/landing-intro')>()),
  useLandingArrival: () => undefined,
}));
const start = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('@/features/morning-feed/watch-prefetch', () => ({
  takeWatchStart: () => Promise.resolve(start.value),
}));
vi.mock('@/features/morning-cards/api', async (orig) => ({
  ...(await orig<typeof import('@/features/morning-cards/api')>()),
  fetchTestClock: () => Promise.resolve(null),
  fetchMorningPageList: () => Promise.resolve([]),
  fetchMorningPage: () => Promise.resolve(null),
  postUsageEvent: () => Promise.resolve(),
}));

import { MorningWatchLive } from '@/features/morning-feed/MorningWatchLive';
import { WATCH_ONB_SEEN_KEY } from '@/features/morning-feed/watch-design';

const CELLS = [
  { label: '기술/개발', short: '기술·개발', dom: 0 },
  { label: '비즈니스/커리어', short: '비즈니스', dom: 1 },
  { label: '오늘 전체', short: '오늘 전체', dom: -1 },
];
const OLDER: MorningPage = {
  domain: '기술/개발',
  seen_date: '2026-11-22',
  headline: '지난 브리프 헤드라인',
  core: [],
  note: [],
  videos: [],
};
const home = (current: MorningPage | null): MorningHomePages => ({
  current,
  lastDomain: null,
  others: [],
  goal: null,
  today: '2026-11-24',
  cells: CELLS,
  experiment: false,
});

function draw(): void {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <MorningWatchLive />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  localStorage.setItem(WATCH_ONB_SEEN_KEY, '1');
});

describe('participant without today’s brief', () => {
  it('shows the newest readable brief (an earlier day) on the home with its date', async () => {
    start.value = [null, [], home(OLDER)];
    draw();
    await waitFor(() =>
      expect(screen.getByTestId('mf-home-headline').textContent).toBe('지난 브리프 헤드라인')
    );
    expect(screen.getByTestId('mf-home-seen').textContent).toBe('11월 22일 일요일');
    expect(screen.queryByTestId('mf-home-empty')).toBeNull();
    expect(document.body.textContent).not.toContain('아직 준비된 브리프가 없습니다');
  });

  it('none at all: the unchanged text inside the home layout (brand, date row, no 지난 브리프)', async () => {
    start.value = [null, [], home(null)];
    draw();
    const empty = await screen.findByTestId('mf-home-empty');
    expect(empty.textContent).toBe('아직 준비된 브리프가 없습니다');
    const root = screen.getByTestId('mf-home');
    expect(root.hasAttribute('data-empty')).toBe(true);
    expect(
      root.querySelector('.mf-home-brand')?.querySelector('[aria-label="Insighta"]')?.textContent
    ).toBe('insighta');
    expect(screen.getByTestId('mf-home-seen').textContent).toBe('11월 24일 화요일');
    // nothing to open: the date is text, not a button
    expect(screen.getByTestId('mf-home-seen').closest('button')).toBeNull();
    expect(screen.queryByTestId('mf-home-meta')).toBeNull();
    expect(screen.queryByTestId('mf-home-past')).toBeNull();
    expect(screen.queryByTestId('mf-home-enter')).toBeNull();
    expect(screen.queryByTestId('mf-home-headline')).toBeNull();
    // the account button of the home's top bar
    expect(root.querySelector('.mf-home-top button')).not.toBeNull();
  });
});
