/**
 * Invite tickets v2 — pure code validation (2026-07-15).
 * (v1 computeRemaining retired with the email-delegation flow.)
 */
process.env['ENCRYPTION_SECRET'] ??=
  'test-secret-test-secret-test-secret-test-secret-test-secret-1234';

import { isValidInviteCode } from '@/modules/invites/manager';

describe('isValidInviteCode', () => {
  it('accepts an 8-char unambiguous-alphabet code', () => {
    expect(isValidInviteCode('aB3xYz9k')).toBe(true);
  });
  it('rejects wrong length and ambiguous/forbidden chars', () => {
    expect(isValidInviteCode('short')).toBe(false);
    expect(isValidInviteCode('aB3xYz9kX')).toBe(false);
    expect(isValidInviteCode('aB3xYz0O')).toBe(false); // 0/O excluded
    expect(isValidInviteCode('')).toBe(false);
    expect(isValidInviteCode('1')).toBe(false);
  });
});
