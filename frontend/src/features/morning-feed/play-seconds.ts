import {
  advanceWatchClock,
  WATCH_POLL_MS,
  YT_STATE_PLAYING,
  type WatchClock,
} from '@/features/morning-feed/use-watch-reporter';

const MS_PER_SECOND = 1000;

/**
 * Real playing seconds of the source sheet's video for the usage record. `take` gives the whole
 * seconds not given yet, so the records of one video add up to the time it played.
 */
export class PlaySeconds {
  private clock: WatchClock = { watchedMs: 0, lastTickMs: null };
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly now: () => number = () => Date.now()) {}

  onState(state: number): void {
    const playing = state === YT_STATE_PLAYING;
    this.clock = advanceWatchClock(this.clock, this.now(), playing);
    if (playing && this.timer == null) {
      this.timer = setInterval(() => {
        this.clock = advanceWatchClock(this.clock, this.now(), true);
      }, WATCH_POLL_MS);
    }
    if (!playing) this.stopTimer();
  }

  /** Whole seconds since the last call; it keeps counting when still playing. */
  take(): number {
    if (this.clock.lastTickMs != null) {
      this.clock = advanceWatchClock(this.clock, this.now(), true);
    }
    const whole = Math.floor(this.clock.watchedMs / MS_PER_SECOND);
    this.clock = { ...this.clock, watchedMs: this.clock.watchedMs - whole * MS_PER_SECOND };
    return whole;
  }

  /** The video is over for the count: nothing carries over to the next one. */
  end(): number {
    const whole = this.take();
    this.stopTimer();
    this.clock = { watchedMs: 0, lastTickMs: null };
    return whole;
  }

  private stopTimer(): void {
    if (this.timer != null) clearInterval(this.timer);
    this.timer = null;
  }
}
