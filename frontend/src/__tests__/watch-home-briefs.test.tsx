import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MorningHomePages, MorningPage } from '@/features/morning-cards/api';

/*
 * Home -> brief -> back (James 2026-11-25): the home's briefs are read when the home is entered and
 * never again; reading ahead is not an open (brief_open once per real open); the home stays mounted
 * under a brief and keeps the chosen domain; the browser's back changes the screen without a slide.
 */

vi.mock('@/features/morning-feed/watch-home-fonts', () => ({
  ensureHomeFonts: () => undefined,
  loadBriefFonts: () => undefined,
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
const api = vi.hoisted(() => ({
  start: null as unknown,
  fetchMorningPage: vi.fn(),
  postUsageEvent: vi.fn(() => Promise.resolve()),
}));
vi.mock('@/features/morning-feed/watch-prefetch', () => ({
  takeWatchStart: () => Promise.resolve(api.start),
}));
vi.mock('@/features/morning-cards/api', async (orig) => ({
  ...(await orig<typeof import('@/features/morning-cards/api')>()),
  fetchTestClock: () => Promise.resolve(null),
  fetchMorningPageList: () =>
    Promise.resolve([{ seen_date: '2026-11-21', headline: '더 지난 헤드라인' }]),
  fetchMorningPage: api.fetchMorningPage,
  postUsageEvent: api.postUsageEvent,
}));

import { MorningWatchLive } from '@/features/morning-feed/MorningWatchLive';
import { WATCH_ONB_SEEN_KEY } from '@/features/morning-feed/watch-design';

const TODAY = '2026-11-25';
const CELLS = [
  { label: '기술/개발', short: '기술·개발', dom: 0 },
  { label: '비즈니스/커리어', short: '비즈니스', dom: 1 },
  { label: '오늘 전체', short: '오늘 전체', dom: -1 },
];
const pageOf = (domain: string, seen_date: string): MorningPage => ({
  domain,
  seen_date,
  headline: domain + ' ' + seen_date,
  core: [{ text: domain + ' 본문.', sources: [] }],
  note: [],
  videos: [],
});
const HOME: MorningHomePages = {
  current: pageOf('기술/개발', TODAY),
  lastDomain: null,
  others: [
    {
      domain: '비즈니스/커리어',
      seen_date: '2026-11-22',
      headline: '비즈니스/커리어 2026-11-22',
    },
  ],
  goal: null,
  today: TODAY,
  cells: CELLS,
  experiment: false,
};
const events = (kind: string): unknown[] =>
  api.postUsageEvent.mock.calls
    .map((c) => (c as unknown as [{ kind: string }])[0])
    .filter((e) => e.kind === kind);
const top = () =>
  within(
    screen.getAllByTestId('mf-stack-layer').find((l) => l.hasAttribute('data-top')) as HTMLElement
  );
const settle = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));
/** The browser's own back button: a popstate the app did not ask for. */
const browserBack = async (idx: number) => {
  act(() => {
    window.dispatchEvent(new PopStateEvent('popstate', { state: { mfScreen: idx } }));
  });
  await settle();
};

beforeEach(async () => {
  // reduced motion: a chip changes the headline at once (its motion has its own tests)
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce') }));
  Object.defineProperty(HTMLElement.prototype, 'animate', {
    configurable: true,
    value: undefined,
  });
  localStorage.setItem(WATCH_ONB_SEEN_KEY, '1');
  api.start = [null, [], HOME];
  api.postUsageEvent.mockClear();
  api.fetchMorningPage.mockReset();
  api.fetchMorningPage.mockImplementation((c: string, d: string) =>
    Promise.resolve({ ...pageOf(c, d), feedback: null })
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <MorningWatchLive />
      </MemoryRouter>
    </QueryClientProvider>
  );
  await waitFor(() => expect(screen.getByTestId('mf-home-headline').textContent).not.toBe(''));
  await settle();
});

describe('briefs are read ahead and kept', () => {
  it('one read per domain on the home, no brief_open; opening shows title and text at once, reads nothing', async () => {
    expect(api.fetchMorningPage.mock.calls).toEqual([
      ['기술/개발', TODAY],
      ['비즈니스/커리어', '2026-11-22'],
    ]);
    expect(events('home_open')).toHaveLength(1);
    expect(events('brief_open')).toHaveLength(0);
    for (let n = 1; n <= 2; n++) {
      fireEvent.click(screen.getAllByTestId('mf-home-chip')[1]!);
      fireEvent.click(screen.getByTestId('mf-home-enter'));
      // in the very same render: no wait, no lines
      expect(top().getByTestId('mf-page-headline').textContent).toBe('비즈니스/커리어 2026-11-22');
      expect(top().getByTestId('mf-page-core').textContent).toContain('비즈니스/커리어 본문.');
      expect(screen.queryByTestId('mf-page-skeleton')).toBeNull();
      await settle();
      expect(events('brief_open')).toHaveLength(n);
      await browserBack(0);
    }
    expect(api.fetchMorningPage).toHaveBeenCalledTimes(2);
    expect(events('home_open')).toHaveLength(1);
  });

  it("the browser's back: the home is the same element with its domain, and nothing slides", async () => {
    const home = screen.getByTestId('mf-home');
    fireEvent.click(screen.getAllByTestId('mf-home-chip')[1]!);
    fireEvent.click(screen.getByTestId('mf-home-enter'));
    await settle();
    await act(() => new Promise<void>((r) => setTimeout(r, 20)));
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate', { state: { mfScreen: 0 } }));
    });
    // gone in the same update: nothing is kept to slide out
    expect(screen.queryByTestId('mf-page')).toBeNull();
    expect(screen.getByTestId('mf-stack').hasAttribute('data-moving')).toBe(false);
    expect(screen.getByTestId('mf-home')).toBe(home);
    expect(screen.getByTestId('mf-home-domain').textContent).toBe('비즈니스');
    expect(screen.getByTestId('mf-home-headline').textContent).toBe('비즈니스/커리어 2026-11-22');
  });
});

describe('오늘로', () => {
  it('not in the list opened from today; in the one opened from an earlier date, back to today', async () => {
    fireEvent.click(screen.getByTestId('mf-home-past'));
    await settle();
    expect(top().queryByTestId('mf-past-today')).toBeNull();
    await browserBack(0);
    // the head shows the earlier date of the chosen domain
    fireEvent.click(screen.getAllByTestId('mf-home-chip')[1]!);
    expect(screen.getByTestId('mf-home-past').textContent).toBe('11월 22일 일요일');
    fireEvent.click(screen.getByTestId('mf-home-past'));
    await settle();
    fireEvent.click(top().getByTestId('mf-past-today'));
    expect(top().getByTestId('mf-home-seen').textContent).toBe('11월 25일 수요일');
    expect(top().getByTestId('mf-home-headline').textContent).toBe('기술/개발 ' + TODAY);
    // a home opened later in the visit is drawn at once
    expect(top().getByTestId('mf-home').hasAttribute('data-ready')).toBe(true);
  });

  it("a past brief's title comes from the list, before its text is read", async () => {
    api.fetchMorningPage.mockImplementation(() => new Promise(() => undefined));
    fireEvent.click(screen.getByTestId('mf-home-past'));
    await settle();
    fireEvent.click(top().getByTestId('mf-past-row'));
    expect(top().getByTestId('mf-page-headline').textContent).toBe('더 지난 헤드라인');
    expect(top().getByTestId('mf-page-seen').textContent).toBe('11월 21일');
    expect(top().getByTestId('mf-page-skeleton')).toBeTruthy();
  });
});
