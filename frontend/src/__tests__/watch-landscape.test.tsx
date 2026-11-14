import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { COARSE_QUERY, SIDEWAYS_QUERY } from '@/features/morning-feed/use-phone-landscape';
import { WatchFeed, type R3Video } from '@/features/morning-feed/watch-r3-feed';

const FRAME = { vh: 642, safeTop: 0, safeBottom: 0, playerH: 219 };

function video(i: number): R3Video {
  return {
    key: 'k' + i,
    videoId: 'v000000000' + i,
    title: '제목 ' + i,
    channel: '채널',
    initial: '채',
    altIcon: false,
    durationSec: 360,
    ageText: '3일 전',
    fresh: true,
    viewsText: '',
    why: '',
    summary: '',
    checks: [],
    chapters: [],
  };
}

function phone(sideways: boolean): void {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: (sideways && q === SIDEWAYS_QUERY) || q === COARSE_QUERY,
    media: q,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

function mount(loading = false) {
  render(
    <WatchFeed
      goalTitle="기술·개발"
      videos={[video(0), video(1), video(2)]}
      frame={FRAME}
      loading={loading}
      initial={{ phase: 'player' }}
      onVerdict={() => undefined}
      onFinish={() => undefined}
      onBack={() => undefined}
      sound={false}
      onSound={() => undefined}
      player={{ current: null }}
      renderPlayer={() => <div data-testid="fake-player" />}
    />
  );
  return {
    root: screen.getByTestId('mf-w3-watch'),
    counter: () => screen.getByTestId('mf-watch-counter').textContent,
    scroll: () => fireEvent.wheel(screen.getByTestId('mf-w3-viewport'), { deltaY: 120 }),
  };
}

describe('phone held sideways (decision 2026-11-14): player only, no moving between videos', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sideways on a video: the player-only mode is on and a scroll does not move the card', () => {
    phone(true);
    const s = mount();
    expect(s.root.hasAttribute('data-land')).toBe(true);
    s.scroll();
    expect(s.counter()).toBe('1 / 3');
  });

  it('upright: the same scroll moves to the next card (control)', () => {
    phone(false);
    const s = mount();
    expect(s.root.hasAttribute('data-land')).toBe(false);
    s.scroll();
    expect(s.counter()).toBe('2 / 3');
  });

  it('touch points count as a touch device when the coarse pointer is not reported yet; a desktop stays off', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: q === SIDEWAYS_QUERY,
      media: q,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    const touch = vi.spyOn(navigator, 'maxTouchPoints', 'get').mockReturnValue(5);
    const a = mount();
    expect(a.root.hasAttribute('data-land')).toBe(true);
    a.root.parentElement?.remove();
    touch.mockReturnValue(0);
    document.body.innerHTML = '';
    const d = mount();
    expect(d.root.hasAttribute('data-land')).toBe(false);
    touch.mockRestore();
  });

  it('sideways while the videos are loading: nothing to show, the mode stays off', () => {
    phone(true);
    expect(mount(true).root.hasAttribute('data-land')).toBe(false);
  });
});
