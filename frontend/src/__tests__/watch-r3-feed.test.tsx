import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WatchFeed, type R3Video, type R3Verdict } from '@/features/morning-feed/watch-r3-feed';

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
    why: '',
    summary: '',
    checks: [],
    chapters: [],
  };
}

function setup() {
  const verdicts: Array<[number, R3Verdict]> = [];
  render(
    <WatchFeed
      goalTitle="기술·개발"
      videos={[video(0), video(1), video(2)]}
      frame={FRAME}
      loading={false}
      initial={{ phase: 'player' }}
      onVerdict={(i, v) => verdicts.push([i, v])}
      onFinish={() => undefined}
      onBack={() => undefined}
      sound={{ current: null }}
      renderPlayer={() => <div data-testid="fake-player" />}
    />
  );
  const current = () =>
    screen.getAllByTestId('mf-w3-card').find((c) => c.hasAttribute('data-current'))!;
  return { verdicts, current };
}

describe('watch 수정 3: feed reactions', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('별로 fades the card content only; the player layer is never dimmed', () => {
    const { verdicts, current } = setup();
    const card = current();
    fireEvent.click(card.querySelector('[data-testid="mf-watch-skip"]')!);
    expect(verdicts).toEqual([[0, 'skip']]);
    expect(card.hasAttribute('data-dim')).toBe(true);
    const layer = screen.getByTestId('mf-watch-player');
    expect(layer.hasAttribute('data-dim')).toBe(false);
    expect(layer.style.opacity).toBe('');
    // the card moves on by itself after the confirmation
    act(() => {
      vi.advanceTimersByTime(800);
    });
    expect(screen.getByTestId('mf-watch-counter').textContent).toBe('2 / 3');
  });

  it('좋아 stays on the card; swiping on afterwards sends no 넘김 (stays 좋아)', () => {
    const { verdicts, current } = setup();
    fireEvent.click(current().querySelector('[data-testid="mf-watch-like"]')!);
    expect(screen.getByTestId('mf-watch-counter').textContent).toBe('1 / 3');
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(screen.getByTestId('mf-watch-counter').textContent).toBe('2 / 3');
    expect(verdicts).toEqual([[0, 'useful']]);
  });

  it('swiping on without a verdict records 넘김 once', () => {
    const { verdicts } = setup();
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(verdicts).toEqual([[0, 'pass']]);
  });
});
