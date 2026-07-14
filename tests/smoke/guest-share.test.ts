/**
 * Guest share token unit tests (2026-07-14) — mint/verify roundtrip,
 * tamper rejection, expiry rejection. The token gates logged-out 48h
 * listening, so its verifier is a security boundary.
 */

// config/index.ts validates at import time — provide the required secret
// before the module graph loads (same pattern as llm-extract test).
process.env['ENCRYPTION_SECRET'] ??=
  'test-secret-test-secret-test-secret-test-secret-test-secret-1234';

import { mintGuestToken, verifyGuestToken } from '@/api/routes/guest-share';

describe('guest share token', () => {
  const MID = '32680ebe-0000-4000-8000-000000000000';

  it('roundtrips a freshly minted token', () => {
    const token = mintGuestToken(MID);
    expect(token.startsWith('g1.')).toBe(true);
    expect(verifyGuestToken(token)).toBe(MID);
  });

  it('rejects a tampered payload', () => {
    const token = mintGuestToken(MID);
    const [p, , sig] = token.split('.');
    const other = Buffer.from(
      JSON.stringify({ m: 'ffffffff-0000-4000-8000-000000000000', x: 9999999999 })
    ).toString('base64url');
    expect(verifyGuestToken(`${p}.${other}.${sig}`)).toBeNull();
  });

  it('rejects a tampered signature and garbage', () => {
    const token = mintGuestToken(MID);
    expect(verifyGuestToken(token.slice(0, -2) + 'xx')).toBeNull();
    expect(verifyGuestToken('g1.abc')).toBeNull();
    expect(verifyGuestToken('')).toBeNull();
  });

  it('rejects an expired token', () => {
    const json = JSON.stringify({ m: MID, x: Math.floor(Date.now() / 1000) - 10 });
    const { createHmac } = require('node:crypto');
    const sig = createHmac('sha256', process.env['ENCRYPTION_SECRET'])
      .update(json)
      .digest('base64url');
    const expired = `g1.${Buffer.from(json).toString('base64url')}.${sig}`;
    expect(verifyGuestToken(expired)).toBeNull();
  });
});
