/**
 * In-app notices (새소식) — public feed limit clamp (2026-07-15).
 */
process.env['ENCRYPTION_SECRET'] ??=
  'test-secret-test-secret-test-secret-test-secret-test-secret-1234';

import { clampNoticeLimit } from '@/api/routes/app-notices';

describe('clampNoticeLimit', () => {
  it('defaults to 20 when absent or garbage', () => {
    expect(clampNoticeLimit(undefined)).toBe(20);
    expect(clampNoticeLimit('abc')).toBe(20);
  });
  it('clamps to [1, 20] and truncates', () => {
    expect(clampNoticeLimit('0')).toBe(1);
    expect(clampNoticeLimit('-5')).toBe(1);
    expect(clampNoticeLimit('7.9')).toBe(7);
    expect(clampNoticeLimit('999')).toBe(20);
  });
});
