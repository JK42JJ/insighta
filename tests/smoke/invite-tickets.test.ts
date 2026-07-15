/**
 * Invite tickets (초대권) — pure derivation tests (2026-07-15).
 * remaining is DERIVED (default − sent count), never stored.
 */
process.env['ENCRYPTION_SECRET'] ??=
  'test-secret-test-secret-test-secret-test-secret-test-secret-1234';

import { computeRemaining } from '@/api/routes/invites';

describe('computeRemaining', () => {
  it('starts at the default allowance', () => {
    expect(computeRemaining(2, 0)).toBe(2);
  });
  it('decrements per sent invite and floors at 0', () => {
    expect(computeRemaining(2, 1)).toBe(1);
    expect(computeRemaining(2, 2)).toBe(0);
    expect(computeRemaining(2, 5)).toBe(0);
  });
  it('ignores negative/fractional noise', () => {
    expect(computeRemaining(2, -1)).toBe(2);
    expect(computeRemaining(2.9, 0)).toBe(2);
  });
});
