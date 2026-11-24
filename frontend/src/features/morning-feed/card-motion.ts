/*
 * Card motion for the live feed: pure numbers, no DOM. The screen paints the result each frame.
 * - settle(): a damped spring that keeps the finger's speed when the card is let go (snap back).
 * - flingDuration(): how long a card takes to leave, shorter for a faster flick, so the exit
 *   starts at the speed of the finger and slows down (no jump between drag and animation).
 */

export interface SpringState {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export const SPRING_SUBSTEP_S = 1 / 240;
const MIN_FLING_S = 0.16;
const MAX_FLING_S = 0.36;
const FLING_POWER = 2.5;
const MIN_FLING_SPEED = 1200; // px/s: even a slow release leaves at a decent pace

/** One frame of a damped spring toward (tx, ty). Stiffness k, damping ratio zeta, dt in seconds. */
export function stepSpring(
  s: SpringState,
  tx: number,
  ty: number,
  k: number,
  zeta: number,
  dt: number
): SpringState {
  const c = 2 * zeta * Math.sqrt(k);
  const n = Math.max(1, Math.ceil(dt / SPRING_SUBSTEP_S));
  const h = dt / n;
  let { x, y, vx, vy } = s;
  for (let i = 0; i < n; i++) {
    vx += (-k * (x - tx) - c * vx) * h;
    vy += (-k * (y - ty) - c * vy) * h;
    x += vx * h;
    y += vy * h;
  }
  return { x, y, vx, vy };
}

export function isSettled(s: SpringState, tx: number, ty: number): boolean {
  return (
    Math.abs(s.x - tx) < 0.4 && Math.abs(s.y - ty) < 0.4 && Math.abs(s.vx) < 8 && Math.abs(s.vy) < 8
  );
}

/** Seconds a card needs to cover `distance` px when let go at `speed` px/s (ease-out power curve). */
export function flingDuration(distance: number, speed: number): number {
  const v = Math.max(speed, MIN_FLING_SPEED);
  const t = (FLING_POWER * distance) / v;
  return Math.min(MAX_FLING_S, Math.max(MIN_FLING_S, t));
}

/** 0..1 progress of the exit: starts at the finger's speed and decelerates. */
export function flingProgress(t: number): number {
  const u = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - u, FLING_POWER);
}

/** Pull that gets heavier the further it goes (used against a direction the card may not go). */
export function rubberBand(offset: number, limit: number): number {
  if (offset === 0) return 0;
  const sign = Math.sign(offset);
  const a = Math.abs(offset);
  return sign * (limit * (1 - 1 / ((a * 0.55) / limit + 1)));
}
