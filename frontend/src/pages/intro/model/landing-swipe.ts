/*
 * Landing swipe rules (James 2026-11-25, from a recording on an iPhone): the page follows the finger
 * 1:1 with the neighbour scene beside it; a swipe counts by distance OR by the speed at release, the
 * same in both directions. Pure functions: the pager (ui/use-scene-pager.ts) feeds them.
 */

/** A swipe counts when it is this much of the screen height … */
export const SWIPE_DISTANCE = 0.12;
/** … or when, at release, it is this fast (screen heights per second). Both tuned on real phones. */
export const SWIPE_SPEED = 0.4;
/** The speed is measured over the last part of the gesture (ms). */
export const SPEED_WINDOW_MS = 100;
/** Movement before a press becomes a drag (px); below it the press stays a tap. */
export const DRAG_SLOP_PX = 8;
/** First scene backwards / last scene forwards: the page follows this share of the finger. */
export const EDGE_RESISTANCE = 0.25;
/** Going on or coming back takes this long. */
export const SETTLE_MS = 300;
export const SETTLE_EASE = 'cubic-bezier(.22,.8,.3,1)';
/** Wheel only: one push sends many events. */
export const WHEEL_MIN = 12;
export const WHEEL_GROUP_MS = 300;
/** Wheel events closer than this belong to the same push (trackpad inertia). */
export const WHEEL_BURST_GAP_MS = 120;
const MIN_SPEED_SPAN_MS = 8;
const PERCENT = 100;
const VALUE_MAX = 999;

export type Dir = 1 | -1;

export interface Sample {
  t: number;
  y: number;
}

/** Keeps the samples the speed needs: the window's, and the one before it. */
export function addSample(list: readonly Sample[], s: Sample): Sample[] {
  const all = [...list, s];
  const from = all.findIndex((x) => s.t - x.t <= SPEED_WINDOW_MS);
  return all.slice(Math.max(0, from - 1));
}

/** Speed (px/s, down positive) over the window before `now`; 0 when the finger rested. */
export function releaseSpeed(list: readonly Sample[], now: number): number {
  const last = list[list.length - 1];
  const first = list.find((x) => now - x.t <= SPEED_WINDOW_MS);
  if (!last || !first || first === last) {
    // one sample in the window: the move before it gives the direction
    const prev = list[list.length - 2];
    if (!last || !prev || now - last.t > SPEED_WINDOW_MS) return 0;
    return ((last.y - prev.y) / Math.max(MIN_SPEED_SPAN_MS, last.t - prev.t)) * 1000;
  }
  return ((last.y - first.y) / Math.max(MIN_SPEED_SPAN_MS, last.t - first.t)) * 1000;
}

/** The direction a released drag goes, or null when it comes back. `dy` and `speed`: up is negative. */
export function judgeSwipe(dy: number, speed: number, height: number): Dir | null {
  if (!(height > 0) || dy === 0) return null;
  const along = Math.sign(dy) * speed;
  const fast = SWIPE_SPEED * height;
  if (along <= -fast) return null; // thrown back
  const far = Math.abs(dy) >= SWIPE_DISTANCE * height;
  if (!far && along < fast) return null;
  return dy < 0 ? 1 : -1;
}

/** Where the page is for a finger movement: 1:1, resisted at the ends, one screen at most. */
export function dragOffset(dy: number, height: number, hasPrev: boolean, hasNext: boolean): number {
  const edge = (dy > 0 && !hasPrev) || (dy < 0 && !hasNext);
  const v = edge ? dy * EDGE_RESISTANCE : dy;
  return Math.max(-height, Math.min(height, v));
}

/**
 * Usage value of one gesture ("ng_34_120"): n(ext)/p(revious), g(one on)/b(ack), distance and speed
 * in % of the screen height (per second). Fits the server's short-token rule.
 */
export function swipeValue(dy: number, speed: number, height: number, went: boolean): string {
  const pct = (x: number): number =>
    Math.min(VALUE_MAX, Math.round((Math.abs(x) / height) * PERCENT));
  return `${dy < 0 ? 'n' : 'p'}${went ? 'g' : 'b'}_${pct(dy)}_${pct(speed)}`;
}
