import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SETTLE_MS, WatchFeed, type R3Video } from '@/features/morning-feed/watch-r3-feed';

const FRAME = { vh: 642, safeTop: 0, safeBottom: 0, playerH: 219 };
const FRAME_MS = 16;

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

describe('player layer follows the arriving slot during a move (2026-11-14)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('every frame of the move the layer sits on the arriving slot, then rests at 0', () => {
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
        renderPlayer={() => <div />}
      />
    );
    const viewport = screen.getByTestId('mf-w3-viewport');
    const slots = screen.getAllByTestId('mf-w3-slot');
    // the arriving slot moves up while the card moves: 500 px, then 300 px below the viewport top
    let slotTop = 500;
    vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue({ top: 100 } as DOMRect);
    vi.spyOn(slots[1]!, 'getBoundingClientRect').mockImplementation(
      () => ({ top: slotTop }) as DOMRect
    );
    const layer = screen.getByTestId('mf-watch-player');
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    });
    act(() => {
      vi.advanceTimersByTime(FRAME_MS * 2);
    });
    expect(layer.style.transform).toBe('translateY(400px)');
    expect(layer.hasAttribute('data-anim')).toBe(false);
    slotTop = 300;
    act(() => {
      vi.advanceTimersByTime(FRAME_MS * 2);
    });
    expect(layer.style.transform).toBe('translateY(200px)');
    act(() => {
      vi.advanceTimersByTime(SETTLE_MS);
    });
    expect(layer.style.transform).toBe('translateY(0px)');
  });
});
