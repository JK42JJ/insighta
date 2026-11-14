import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WatchPlayer, type PlayerController } from '@/features/morning-feed/WatchPlayer';

vi.mock('@/features/morning-feed/use-watch-reporter', () => ({
  useWatchReporter: () => ({
    reporter: { onState: () => undefined, setVideo: () => undefined },
    positionRef: { current: () => 0 },
  }),
}));

const PLAYING = 1;
const BUFFERING = 3;

/** A stand-in for the YouTube IFrame player: state and muted are set by the test. */
class FakeYtPlayer {
  static last: FakeYtPlayer | null = null;
  state = -1;
  muted = true;
  /** iOS lag: isMuted() keeps returning the old value for a while after a change. */
  lagMuted: boolean | null = null;
  loads: string[] = [];
  events: Record<string, (e: { target: FakeYtPlayer; data?: number }) => void>;
  constructor(_el: HTMLElement, opts: { events: FakeYtPlayer['events'] }) {
    this.events = opts.events;
    FakeYtPlayer.last = this;
  }
  loadVideoById(a: { videoId: string }): void {
    this.loads.push(a.videoId);
    this.state = BUFFERING;
  }
  mute(): void {
    this.muted = true;
  }
  unMute(): void {
    this.muted = false;
  }
  isMuted(): boolean {
    return this.lagMuted ?? this.muted;
  }
  getPlayerState(): number {
    return this.state;
  }
  getCurrentTime(): number {
    return 0;
  }
  getDuration(): number {
    return 100;
  }
  playVideo(): void {}
  pauseVideo(): void {}
  destroy(): void {}
}

async function mount() {
  (window as unknown as { YT: unknown }).YT = { Player: FakeYtPlayer };
  const controller: { current: PlayerController | null } = { current: null };
  const muted: boolean[] = [];
  render(<WatchPlayer controller={controller} onMuted={(m) => muted.push(m)} />);
  // the API promise resolves on the next microtask
  await act(async () => {
    await Promise.resolve();
  });
  const yt = FakeYtPlayer.last!;
  act(() => yt.events.onReady({ target: yt }));
  return { controller, yt, muted };
}

describe('WatchPlayer sound kept across swaps (device log 2026-11-13)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    FakeYtPlayer.last = null;
  });

  it('rapid swaps: an earlier check never judges the next video (no false fallback)', async () => {
    const { controller, yt, muted } = await mount();
    act(() => controller.current!.load('aaaaaaaaaaa', 0, true));
    act(() => {
      vi.advanceTimersByTime(500);
    });
    act(() => controller.current!.load('bbbbbbbbbbb', 0, true));
    // 1.5 s after the FIRST load the second video is still buffering: an uncancelled check
    // would have muted it here
    act(() => {
      vi.advanceTimersByTime(1100);
    });
    expect(yt.muted).toBe(false);
    yt.state = PLAYING;
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(yt.muted).toBe(false);
    expect(muted).not.toContain(true);
    expect(yt.loads).toEqual(['aaaaaaaaaaa', 'bbbbbbbbbbb']);
  });

  it('a lagging isMuted() right after our own sound-on does not turn the sound off', async () => {
    const { controller, yt, muted } = await mount();
    act(() => controller.current!.soundOn());
    expect(muted).toEqual([false]);
    // iOS keeps reporting muted for a moment; the poll runs every 250 ms
    yt.lagMuted = true;
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(muted).toEqual([false]);
    yt.lagMuted = null;
    act(() => controller.current!.load('ccccccccccc', 0, true));
    expect(yt.muted).toBe(false);
  });

  it('really refused sound: stopped without playing -> muted playback at the check, the screen is told', async () => {
    const { controller, yt, muted } = await mount();
    act(() => controller.current!.load('ddddddddddd', 0, true));
    // the browser does not start it (unstarted, not loading)
    yt.state = -1;
    act(() => {
      vi.advanceTimersByTime(1600);
    });
    expect(yt.muted).toBe(true);
    expect(muted[muted.length - 1]).toBe(true);
  });

  it('slow load keeps the sound: still buffering at 1.5 s, PLAYING with sound at 4 s (2026-11-14)', async () => {
    const { controller, yt, muted } = await mount();
    act(() => controller.current!.load('eeeeeeeeeee', 0, true));
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    // the fixed 1.5 s check muted here
    expect(yt.muted).toBe(false);
    yt.state = PLAYING;
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(yt.muted).toBe(false);
    expect(muted).not.toContain(true);
  });

  it('PLAYING but muted by the browser: back to muted state', async () => {
    const { controller, yt, muted } = await mount();
    act(() => controller.current!.load('fffffffffff', 0, true));
    yt.state = PLAYING;
    yt.lagMuted = true;
    act(() => {
      vi.advanceTimersByTime(1600);
    });
    expect(yt.muted).toBe(true);
    expect(muted[muted.length - 1]).toBe(true);
  });

  it('still loading after 6 s: gives up on sound for this video', async () => {
    const { controller, yt, muted } = await mount();
    act(() => controller.current!.load('ggggggggggg', 0, true));
    act(() => {
      vi.advanceTimersByTime(6600);
    });
    expect(yt.muted).toBe(true);
    expect(muted[muted.length - 1]).toBe(true);
  });
});
