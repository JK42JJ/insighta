/*
 * Watch screen card motion (design 수정 4), pure and unit tested: when the player layer that
 * slides in with a card becomes more than half visible (YouTube: no automatic playback before
 * that), and the progress of the line at the player's edge between two position reads.
 */

/** The card transition: transform .42s cubic-bezier(.2,.8,.2,1) (README §3). */
export const CARD_MOVE_MS = 420;
const EASE = [0.2, 0.8, 0.2, 1] as const;
const SAMPLES = 200;
const PERCENT = 100;

/** Point of the cubic bezier (0,0)-(x1,y1)-(x2,y2)-(1,1) at parameter u, one axis. */
function bezier(u: number, a: number, b: number): number {
  const v = 1 - u;
  return 3 * v * v * u * a + 3 * v * u * u * b + u * u * u;
}

/** Fraction of the transition time (0..1) at which the eased progress first reaches `progress`. */
export function easeTimeFor(progress: number): number {
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;
  for (let i = 1; i <= SAMPLES; i++) {
    const u = i / SAMPLES;
    if (bezier(u, EASE[1], EASE[3]) >= progress) return bezier(u, EASE[0], EASE[2]);
  }
  return 1;
}

export interface RevealInput {
  /** +1 = the next card comes up from below, -1 = the previous card comes down from above. */
  dir: 1 | -1;
  /** How far the stack moves: the height of the card leaving (forward) or arriving (back). */
  distance: number;
  /** Visible height of the card area (below the header). */
  viewportH: number;
  /** Player slot top inside a card (the channel row). */
  slotTop: number;
  playerH: number;
}

/**
 * Milliseconds after the move starts at which more than half of the arriving player is inside
 * the card area. Forward: the slot starts `distance` below its resting place and rises.
 * Back: it starts `distance` above and comes down.
 */
export function revealDelayMs(m: RevealInput): number {
  const half = m.playerH / 2;
  const need =
    m.dir === 1
      ? 1 - (m.viewportH - m.slotTop - half) / m.distance
      : 1 - (m.slotTop + half) / m.distance;
  return Math.round(easeTimeFor(Math.min(1, Math.max(0, need))) * CARD_MOVE_MS);
}

/** Line width (0..100) from the last read position, advanced by the time since when playing. */
export function progressPercent(
  t: { seconds: number; duration: number; playing: boolean; at: number },
  now: number
): number {
  if (!(t.duration > 0)) return 0;
  const s = t.seconds + (t.playing ? Math.max(0, now - t.at) / 1000 : 0);
  return Math.min(PERCENT, Math.max(0, (s / t.duration) * PERCENT));
}
