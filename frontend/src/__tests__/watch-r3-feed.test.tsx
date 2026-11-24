import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PlayerController } from '@/features/morning-feed/WatchPlayer';
import {
  WatchFeed,
  type R3PlayerEvents,
  type R3Verdict,
  type R3Video,
} from '@/features/morning-feed/watch-r3-feed';

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
    viewsText: '조회수 1.2만회',
    why: '',
    summary: '',
    checks: [],
    chapters: [],
  };
}

function setup(opts: { sound?: boolean } = {}) {
  const verdicts: Array<[number, R3Verdict]> = [];
  const loads: Array<[string, number, boolean]> = [];
  const player: { current: PlayerController | null } = {
    current: {
      load: (id, start, withSound) => loads.push([id, start, withSound]),
      soundOn: () => undefined,
      soundOff: () => undefined,
      pause: () => undefined,
    },
  };
  let events: R3PlayerEvents | null = null;
  const sounds: boolean[] = [];
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
      sound={opts.sound ?? false}
      onSound={(on) => sounds.push(on)}
      player={player}
      renderPlayer={(e) => {
        events = e;
        return <div data-testid="fake-player" />;
      }}
    />
  );
  const current = () =>
    screen.getAllByTestId('mf-w3-card').find((c) => c.hasAttribute('data-current'))!;
  const counter = () => screen.getByTestId('mf-watch-counter').textContent;
  return { verdicts, loads, current, counter, sounds, events: () => events! };
}

describe('watch 수정 4: feed reactions and moves', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('별로 fades the card content only; the player layer is never dimmed', () => {
    const { verdicts, current, counter } = setup();
    const card = current();
    fireEvent.click(card.querySelector('[data-testid="mf-watch-skip"]')!);
    expect(verdicts).toEqual([[0, 'skip']]);
    expect(card.hasAttribute('data-dim')).toBe(true);
    const layer = screen.getByTestId('mf-watch-player');
    expect(layer.hasAttribute('data-dim')).toBe(false);
    expect(layer.style.opacity).toBe('');
    act(() => {
      vi.advanceTimersByTime(800);
    });
    expect(counter()).toBe('2 / 3');
  });

  it('좋아 stays on the card; swiping on afterwards sends no 넘김 (stays 좋아)', () => {
    const { verdicts, current, counter } = setup();
    fireEvent.click(current().querySelector('[data-testid="mf-watch-like"]')!);
    expect(counter()).toBe('1 / 3');
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(counter()).toBe('2 / 3');
    expect(verdicts).toEqual([[0, 'useful']]);
  });

  it('going back shows the passed card with "넘김", and it can still become 좋아', () => {
    const { verdicts, current, counter } = setup();
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(verdicts).toEqual([[0, 'pass']]);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    expect(counter()).toBe('1 / 3');
    expect(current().querySelector('[data-testid="mf-w3-confirm"]')!.textContent).toBe('넘김');
    act(() => {
      vi.advanceTimersByTime(500);
    });
    fireEvent.click(current().querySelector('[data-testid="mf-watch-like"]')!);
    expect(verdicts).toEqual([
      [0, 'pass'],
      [0, 'useful'],
    ]);
  });

  it('좋아 and 별로 cannot be changed on a card seen again', () => {
    const { verdicts, current } = setup();
    fireEvent.click(current().querySelector('[data-testid="mf-watch-like"]')!);
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    fireEvent.click(current().querySelector('[data-testid="mf-watch-skip"]')!);
    expect(verdicts).toEqual([[0, 'useful']]);
    expect(current().querySelector('[data-testid="mf-w3-confirm"]')!.textContent).toBe('좋아');
  });

  it('the first card does not go back', () => {
    const { counter } = setup();
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    expect(counter()).toBe('1 / 3');
  });

  it('videos load muted in the feed; a revisited card resumes where it was', () => {
    const { loads, events } = setup();
    act(() => events().onReady());
    expect(loads[0]).toEqual(['v0000000000', 0, false]);
    act(() =>
      events().onTick({ videoId: 'v0000000000', seconds: 42, duration: 360, playing: true })
    );
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(loads[loads.length - 1]).toEqual(['v0000000000', 42, false]);
  });

  it('the mute button turns the sound on and enters immersive playback; the next video keeps it', () => {
    const { loads, events, sounds } = setup({ sound: true });
    act(() => events().onReady());
    fireEvent.click(screen.getByTestId('mf-w3-mute'));
    expect(screen.getByTestId('mf-w3-watch').getAttribute('data-mode')).toBe('imm');
    expect(sounds).toEqual([true]);
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    // session sound is on (prop) and the screen is immersive: the next video asks for sound
    expect(loads[loads.length - 1]).toEqual(['v0000000001', 0, true]);
  });
});
