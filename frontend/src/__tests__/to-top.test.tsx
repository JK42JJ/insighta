import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MorningPage } from '@/features/morning-cards/api';
import { nextToTop, TO_TOP_START, type ToTopState } from '@/features/morning-feed/use-to-top';
import { WatchPage } from '@/features/morning-feed/WatchPage';

vi.mock('@/features/morning-feed/watch-home-fonts', () => ({
  ensureHomeFonts: () => undefined,
}));

/* Order 2026-11-25 B6: when the "up" button of the article shows. */

const SCREEN = 600;
const HEIGHT = 4000;
const run = (tops: number[], height = HEIGHT): ToTopState =>
  tops.reduce((s, top) => nextToTop(s, { top, height, screen: SCREEN }), {
    ...TO_TOP_START,
    height,
  });

describe('nextToTop', () => {
  it('shows on an upward scroll that starts 1.5 screens down or more', () => {
    expect(run([500, 1000, 1500]).shown).toBe(false);
    expect(run([1500, 1480]).shown).toBe(true);
    expect(run([880, 860]).shown).toBe(false);
    expect(run([900, 880]).shown).toBe(true);
  });
  it('a few px of jitter are no direction', () => {
    expect(run([1500, 1495, 1500, 1494]).shown).toBe(false);
    expect(run([1500, 1495, 1490]).shown).toBe(true);
  });
  it('stays while going up, hides on the way down and near the top', () => {
    expect(run([1500, 1400, 800, 400]).shown).toBe(true);
    expect(run([1500, 1400, 1420]).shown).toBe(false);
    expect(run([1500, 1400, 280]).shown).toBe(false);
    // up again from less than 1.5 screens: stays hidden
    expect(run([1500, 1400, 280, 500, 400]).shown).toBe(false);
  });
  it("Safari's bounce at the end and a changed content height are no upward scroll", () => {
    expect(run([3400, 3460, 3400]).shown).toBe(false);
    const folded = nextToTop(run([3000]), { top: 1500, height: 2100, screen: SCREEN });
    expect(folded.shown).toBe(false);
  });
});

const PAGE: MorningPage = {
  domain: '기술/개발',
  seen_date: '2026-11-25',
  headline: '헤드라인',
  core: [{ text: '문장.', sources: [{ video_id: 'aaaaaaaaaaa', t: 77 }] }],
  note: [],
  videos: [{ video_id: 'aaaaaaaaaaa', title: '제목', channel: '채널', useful_for: '' }],
};
const PROPS = {
  frame: { vh: SCREEN, safeTop: 0, safeBottom: 0, playerH: 219, width: 390 },
  page: PAGE,
  domainTitle: '기술·개발',
  order: [],
  others: [],
  today: '2026-11-25',
  back: { label: '홈', onBack: () => undefined },
  onPast: () => undefined,
  feedback: { value: null, onPick: () => Promise.resolve() },
};

describe('up button (screen)', () => {
  let scroll: HTMLElement;
  let up: HTMLElement;
  const to = (top: number): void => {
    scroll.scrollTop = top;
    fireEvent.scroll(scroll);
  };
  const shown = (): boolean => up.hasAttribute('data-shown');
  const size = (): void => {
    scroll = screen.getByTestId('mf-page-scroll');
    up = screen.getByTestId('mf-page-up');
    Object.defineProperties(scroll, {
      scrollHeight: { value: HEIGHT, configurable: true },
      clientHeight: { value: SCREEN, configurable: true },
    });
    // the height was read before the test gave it
    to(0);
    up.getBoundingClientRect = () => ({ top: 540, bottom: 584 }) as DOMRect;
    screen.getByTestId('mf-page-feedback').getBoundingClientRect = () =>
      ({ top: 2000, bottom: 2100 }) as DOMRect;
  };
  beforeEach(() => {
    window.matchMedia = vi.fn(() => ({ matches: false })) as never;
  });

  it('has the soft press, shows on the way up, goes to the top smoothly and stays hidden on the way', () => {
    render(<WatchPage {...PROPS} />);
    size();
    expect(up.getAttribute('data-press')).toBe('soft');
    expect(up.getAttribute('aria-label')).toBe('맨 위로');
    expect(up.getAttribute('aria-hidden')).toBe('true');
    to(1500);
    expect(shown()).toBe(false);
    to(1450);
    expect(shown()).toBe(true);
    const scrollTo = vi.fn();
    scroll.scrollTo = scrollTo as never;
    fireEvent.click(up);
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
    to(1300);
    to(1000);
    expect(shown()).toBe(false);
  });

  it('reduced motion: at the top at once', () => {
    window.matchMedia = vi.fn(() => ({ matches: true })) as never;
    render(<WatchPage {...PROPS} />);
    size();
    to(1500);
    to(1450);
    fireEvent.click(up);
    expect(scroll.scrollTop).toBe(0);
  });

  it('is hidden over the reaction area and while the source sheet is open', () => {
    const { rerender } = render(<WatchPage {...PROPS} />);
    size();
    to(1500);
    to(1450);
    expect(shown()).toBe(true);
    const fb = screen.getByTestId('mf-page-feedback');
    fb.getBoundingClientRect = () => ({ top: 500, bottom: 600 }) as DOMRect;
    to(1400);
    expect(shown()).toBe(false);
    fb.getBoundingClientRect = () => ({ top: 700, bottom: 800 }) as DOMRect;
    to(1300);
    expect(shown()).toBe(true);
    act(() => rerender(<WatchPage {...PROPS} source={{ sid: 'p0.s0', sheetH: 0 }} />));
    expect(shown()).toBe(false);
    act(() => rerender(<WatchPage {...PROPS} source={null} />));
    expect(shown()).toBe(false);
  });
});
