import { computeRotationOffset } from '../executor';

const DAY = 86_400_000;

describe('computeRotationOffset', () => {
  it('cycles through 3 windows of 60', () => {
    // Pick 3 consecutive UTC midnights. Anchor to 2026-04-15T00:00:00Z.
    const anchor = Date.UTC(2026, 3, 15); // day-of-epoch = N
    const a0 = computeRotationOffset(anchor, 60, 3);
    const a1 = computeRotationOffset(anchor + DAY, 60, 3);
    const a2 = computeRotationOffset(anchor + 2 * DAY, 60, 3);
    const a3 = computeRotationOffset(anchor + 3 * DAY, 60, 3);
    const seen = new Set([a0, a1, a2]);
    // All three windows are distinct and within {0, 60, 120}.
    expect(seen.size).toBe(3);
    expect([...seen].sort((x, y) => x - y)).toEqual([0, 60, 120]);
    // Day 3 loops back to day 0.
    expect(a3).toBe(a0);
  });

  it('returns 0 when rotationDays is 1', () => {
    expect(computeRotationOffset(Date.now(), 60, 1)).toBe(0);
  });

  it('clamps rotationDays below 1 to 1', () => {
    expect(computeRotationOffset(Date.now(), 60, 0)).toBe(0);
    expect(computeRotationOffset(Date.now(), 60, -5)).toBe(0);
  });
});
