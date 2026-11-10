import { useEffect, useRef } from 'react';

import { postWatchProgress, type WatchProgressBody } from '@/features/morning-cards/api';

/** How often the playhead is sampled while the video is playing. */
export const WATCH_POLL_MS = 5000;
/** The most often a progress write is sent while playing. */
export const WATCH_REPORT_MS = 15_000;
/** YT.PlayerState.PLAYING */
export const YT_STATE_PLAYING = 1;
const MS_PER_SECOND = 1000;

export interface WatchClock {
  /** Wall-clock milliseconds spent in the playing state. */
  watchedMs: number;
  /** Time of the previous sample, or null while not playing. */
  lastTickMs: number | null;
}

/**
 * Adds the time since the previous sample, capped at one poll interval. Wall-clock time is used,
 * not playhead movement, so seeking forward or back never inflates the watched time.
 */
export function advanceWatchClock(
  clock: WatchClock,
  nowMs: number,
  playing: boolean,
  pollMs: number = WATCH_POLL_MS
): WatchClock {
  const delta =
    clock.lastTickMs == null ? 0 : Math.min(Math.max(0, nowMs - clock.lastTickMs), pollMs);
  return { watchedMs: clock.watchedMs + delta, lastTickMs: playing ? nowMs : null };
}

export function watchedWholeSeconds(clock: WatchClock): number {
  return Math.floor(clock.watchedMs / MS_PER_SECOND);
}

export interface WatchReporterDeps {
  send: (body: WatchProgressBody) => void;
  now: () => number;
  /** Playhead in seconds; may throw while the player is not ready. */
  position: () => number;
}

/** Counts real playing time for the card on screen and reports it. Plain class so it can be tested. */
export class WatchReporter {
  private videoId: string | null = null;
  private clock: WatchClock = { watchedMs: 0, lastTickMs: null };
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastSentAt = 0;
  private lastSent: { seconds: number; position: number } | null = null;

  constructor(private readonly deps: WatchReporterDeps) {}

  /** A different card: the previous one is reported first, then the count starts again. */
  setVideo(videoId: string): void {
    if (videoId === this.videoId) return;
    this.halt();
    this.flush();
    this.videoId = videoId;
    this.clock = { watchedMs: 0, lastTickMs: null };
    this.lastSent = null;
    this.lastSentAt = 0;
  }

  onState(state: number): void {
    if (state === YT_STATE_PLAYING) {
      if (this.clock.lastTickMs == null) {
        this.clock = { ...this.clock, lastTickMs: this.deps.now() };
        this.lastSentAt = this.deps.now();
      }
      if (this.timer == null) this.timer = setInterval(() => this.poll(), WATCH_POLL_MS);
      return;
    }
    this.halt();
    this.flush();
  }

  /** Page hidden or screen closing: count what has played and send it now. */
  flushNow(): void {
    if (this.clock.lastTickMs != null) {
      this.clock = advanceWatchClock(this.clock, this.deps.now(), true);
    }
    this.flush();
  }

  dispose(): void {
    this.halt();
    this.flush();
    this.videoId = null;
  }

  private poll(): void {
    this.clock = advanceWatchClock(this.clock, this.deps.now(), true);
    if (this.deps.now() - this.lastSentAt >= WATCH_REPORT_MS) this.flush();
  }

  private halt(): void {
    this.clock = advanceWatchClock(this.clock, this.deps.now(), false);
    if (this.timer != null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private flush(): void {
    const seconds = watchedWholeSeconds(this.clock);
    if (!this.videoId || seconds <= 0) return;
    let position = 0;
    try {
      position = Math.max(0, Math.floor(this.deps.position()));
    } catch {
      /* player gone: the position stays 0 */
    }
    if (this.lastSent && this.lastSent.seconds === seconds && this.lastSent.position === position) {
      return;
    }
    this.lastSent = { seconds, position };
    this.lastSentAt = this.deps.now();
    this.deps.send({ video_id: this.videoId, watched_seconds: seconds, last_position: position });
  }
}

/**
 * One reporter per player. `position` is filled in by the player once it is ready.
 * Returns stable handlers for the player to call.
 */
export function useWatchReporter(videoId: string) {
  const positionRef = useRef<() => number>(() => 0);
  const reporter = useRef<WatchReporter | null>(null);
  if (reporter.current === null) {
    reporter.current = new WatchReporter({
      send: (body) => void postWatchProgress(body),
      now: () => Date.now(),
      position: () => positionRef.current(),
    });
  }
  const r = reporter.current;

  // Declared before the player's own card-change effect, so the previous card is reported while
  // the player is still on it.
  useEffect(() => {
    r.setVideo(videoId);
  }, [r, videoId]);

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') r.flushNow();
    };
    const onPageHide = () => r.flushNow();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
      r.dispose();
    };
  }, [r]);

  return { reporter: r, positionRef };
}
