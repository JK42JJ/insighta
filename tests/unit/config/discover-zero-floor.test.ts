/**
 * Never-zero floor gate (P0 2026-07-11, kapasi 0-card mode).
 * Unset = fail-closed legacy (flag alone rolls back).
 */
import { isDiscoverNeverZeroFloorEnabled, getZeroFloorMax } from '@/config/discover-zero-floor';

describe('discover-zero-floor config', () => {
  test('unset → disabled (legacy fail-closed)', () => {
    expect(isDiscoverNeverZeroFloorEnabled({})).toBe(false);
  });

  test.each(['true', '1', 'yes', 'TRUE'])('enabled by %s', (v) => {
    expect(isDiscoverNeverZeroFloorEnabled({ DISCOVER_NEVER_ZERO_FLOOR: v })).toBe(true);
  });

  test.each(['false', '0', 'no', ''])('disabled for %s', (v) => {
    expect(isDiscoverNeverZeroFloorEnabled({ DISCOVER_NEVER_ZERO_FLOOR: v })).toBe(false);
  });

  test('floor max default 16, env override, invalid → default', () => {
    expect(getZeroFloorMax({})).toBe(16);
    expect(getZeroFloorMax({ DISCOVER_ZERO_FLOOR_MAX: '8' })).toBe(8);
    expect(getZeroFloorMax({ DISCOVER_ZERO_FLOOR_MAX: 'abc' })).toBe(16);
    expect(getZeroFloorMax({ DISCOVER_ZERO_FLOOR_MAX: '0' })).toBe(16);
    expect(getZeroFloorMax({ DISCOVER_ZERO_FLOOR_MAX: '-3' })).toBe(16);
  });
});
