/**
 * Regression (2026-11-11): the add-cards route accepts a per-request `targetLevel` only when it is
 * one of the canonical wizard levels; anything else falls back to the mandala's stored level.
 */
import { isTargetLevel, TARGET_LEVELS } from '../../src/modules/mandala/target-level';

describe('isTargetLevel', () => {
  it('accepts exactly the wizard levels', () => {
    for (const level of TARGET_LEVELS) expect(isTargetLevel(level)).toBe(true);
  });

  it('rejects legacy keys, other casing, empty, non-strings and prototype keys', () => {
    for (const v of [
      'beginner',
      'expert',
      'Foundation',
      ' advanced',
      '',
      'constructor',
      1,
      null,
      undefined,
    ]) {
      expect(isTargetLevel(v)).toBe(false);
    }
  });
});
