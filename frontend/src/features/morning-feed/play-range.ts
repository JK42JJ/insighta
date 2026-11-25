/*
 * Which parts of a video were played (order 2026-11-25 D1 "영상 재생 구간"), pure: the player's
 * position is sampled while the video is on screen. A part goes on while the position moves as far
 * as the time that passed allows; a jump (seek), a stop or another video ends it.
 */

export interface PlayRange {
  videoId: string;
  startSec: number;
  endSec: number;
}

/** Fastest playback speed YouTube offers. */
const MAX_RATE = 2;
/** Sampling and reporting slack (s). */
const SLACK_S = 1.5;
/** Shorter parts are not recorded (s). */
const MIN_RANGE_S = 1;

export class PlayRanges {
  private cur: { videoId: string; start: number; end: number; at: number } | null = null;

  constructor(private readonly emit: (r: PlayRange) => void) {}

  /** @param now milliseconds */
  sample(videoId: string, seconds: number, playing: boolean, now: number): void {
    const c = this.cur;
    if (!Number.isFinite(seconds)) return;
    if (c) {
      const moved = seconds - c.end;
      const room = ((now - c.at) / 1000) * MAX_RATE + SLACK_S;
      const goesOn = c.videoId === videoId && moved >= 0 && moved <= room;
      if (goesOn) {
        c.end = seconds;
        c.at = now;
      }
      if (!goesOn || !playing) this.end();
    }
    if (playing && !this.cur) this.cur = { videoId, start: seconds, end: seconds, at: now };
  }

  /** The video was stopped, switched or left. */
  end(): void {
    const c = this.cur;
    this.cur = null;
    if (!c || c.end - c.start < MIN_RANGE_S) return;
    this.emit({
      videoId: c.videoId,
      startSec: Math.floor(c.start),
      endSec: Math.ceil(c.end),
    });
  }
}
