import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SETTLE_MS, WatchFeed, type R3Video } from '@/features/morning-feed/watch-r3-feed';
import { CHANNEL_ROW_H } from '@/features/morning-feed/watch-r3-layout';

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

describe('the player moves with its card by one transform (scenario test 2026-11-14)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("the player is inside the card stack, on the current card's slot, and stays the same element", () => {
    render(
      <WatchFeed
        goalTitle="기술·개발"
        videos={[video(0), video(1), video(2)]}
        frame={FRAME}
        loading={false}
        initial={{ phase: 'player' }}
        onVerdict={() => undefined}
        onFinish={() => undefined}
        onBack={() => undefined}
        sound={false}
        onSound={() => undefined}
        player={{ current: null }}
        renderPlayer={() => <div data-testid="the-player" />}
      />
    );
    const layer = screen.getByTestId('mf-watch-player');
    const node = screen.getByTestId('the-player');
    // one transform for both: the layer is a child of the moving stack, with no transform of its own
    expect(layer.parentElement?.classList.contains('mf-w3-stack')).toBe(true);
    expect(layer.style.transform).toBe('');
    expect(layer.style.top).toBe(CHANNEL_ROW_H + 'px');
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    });
    act(() => {
      vi.advanceTimersByTime(SETTLE_MS);
    });
    // on the second card's slot: the first card's height + the channel row
    expect(parseFloat(layer.style.top)).toBeGreaterThan(CHANNEL_ROW_H);
    // the same layer and the same player element (never re-created, so YouTube never reloads)
    expect(screen.getByTestId('mf-watch-player')).toBe(layer);
    expect(screen.getByTestId('the-player')).toBe(node);
  });
});
