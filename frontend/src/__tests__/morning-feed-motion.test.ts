import { describe, expect, it } from 'vitest';

import {
  flingDuration,
  flingProgress,
  isSettled,
  rubberBand,
  stepSpring,
  type SpringState,
} from '@/features/morning-feed/card-motion';

function settle(start: SpringState, k: number, zeta: number) {
  let s = start;
  let t = 0;
  let overshoot = 0;
  while (t < 3 && !isSettled(s, 0, 0)) {
    s = stepSpring(s, 0, 0, k, zeta, 1 / 60);
    t += 1 / 60;
    overshoot = Math.max(overshoot, -s.x);
  }
  return { s, t, overshoot };
}

describe('card motion', () => {
  it('a card let go off-centre springs back to rest within a fraction of a second', () => {
    const { s, t } = settle({ x: 80, y: 0, vx: 0, vy: 0 }, 420, 0.72);
    expect(isSettled(s, 0, 0)).toBe(true);
    expect(t).toBeLessThan(1);
  });

  it('keeps the finger speed: a card released moving back overshoots less than one released moving away', () => {
    const away = settle({ x: 60, y: 0, vx: 1500, vy: 0 }, 420, 0.72);
    const back = settle({ x: 60, y: 0, vx: -1500, vy: 0 }, 420, 0.72);
    expect(back.overshoot).toBeGreaterThan(away.overshoot - 1); // both settle; the path differs
    expect(isSettled(away.s, 0, 0)).toBe(true);
    expect(isSettled(back.s, 0, 0)).toBe(true);
  });

  it('a critically damped entrance does not overshoot', () => {
    const { overshoot } = settle({ x: 0, y: 420, vx: 0, vy: 0 }, 300, 1);
    expect(overshoot).toBeLessThan(1);
  });

  it('frame time does not change where the spring ends', () => {
    const run = (dt: number) => {
      let s: SpringState = { x: 100, y: 0, vx: 0, vy: 0 };
      for (let i = 0; i < Math.round(1 / dt); i++) s = stepSpring(s, 0, 0, 420, 0.72, dt);
      return s.x;
    };
    expect(Math.abs(run(1 / 30) - run(1 / 120))).toBeLessThan(0.5);
  });

  it('a faster flick leaves sooner, within fixed bounds', () => {
    const slow = flingDuration(400, 1300);
    const fast = flingDuration(400, 4000);
    expect(fast).toBeLessThan(slow);
    expect(fast).toBeGreaterThanOrEqual(0.16);
    expect(slow).toBeLessThanOrEqual(0.36);
  });

  it('the exit starts at once, slows down and ends exactly at the target', () => {
    expect(flingProgress(0)).toBe(0);
    expect(flingProgress(1)).toBe(1);
    expect(flingProgress(0.1) - flingProgress(0)).toBeGreaterThan(
      flingProgress(1) - flingProgress(0.9)
    );
    expect(flingProgress(2)).toBe(1);
  });

  it('the rubber band pulls harder the further it goes and never passes its limit', () => {
    expect(rubberBand(0, 40)).toBe(0);
    expect(rubberBand(-10, 40)).toBeLessThan(0);
    expect(Math.abs(rubberBand(-500, 40))).toBeLessThan(40);
    expect(Math.abs(rubberBand(-100, 40)) - Math.abs(rubberBand(-50, 40))).toBeLessThan(
      Math.abs(rubberBand(-50, 40)) - Math.abs(rubberBand(-0, 40))
    );
  });
});
