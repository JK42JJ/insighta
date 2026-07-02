import { describe, it, expect } from 'vitest';
import { shouldAppendRound } from './round-guard';

describe('shouldAppendRound — cross-mandala round leak guard (2026-07-03 incident)', () => {
  it('BLOCKS a result requested for a DIFFERENT mandala (the leak)', () => {
    // mandala A's stale success re-firing after switching to mandala B
    expect(shouldAppendRound('mandala-A', 'mandala-B', [], 'round-1')).toBe(false);
  });

  it('allows a result requested for the current mandala', () => {
    expect(shouldAppendRound('mandala-B', 'mandala-B', [], 'round-1')).toBe(true);
  });

  it('BLOCKS when the round is already appended (idempotency)', () => {
    expect(shouldAppendRound('mandala-B', 'mandala-B', ['round-1'], 'round-1')).toBe(false);
  });

  it('BLOCKS when no mandala is open or the result has no mandala', () => {
    expect(shouldAppendRound('mandala-A', null, [], 'round-1')).toBe(false);
    expect(shouldAppendRound(undefined, 'mandala-B', [], 'round-1')).toBe(false);
  });
});
