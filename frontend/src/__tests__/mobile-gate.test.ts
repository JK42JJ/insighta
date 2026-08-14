import { describe, expect, it } from 'vitest';
import { isPathAllowedOnMobile } from '@/shared/lib/mobile-gate';

describe('mobile gate allowlist', () => {
  it.each([
    '/landing',
    '/login',
    '/beta',
    '/pricing',
    '/templates',
    '/templates/study-abroad',
    '/privacy',
    '/terms',
    '/help',
  ])('allows marketing/legal surface %s on mobile', (path) => {
    expect(isPathAllowedOnMobile(path)).toBe(true);
  });

  it.each([
    '/',
    '/mandalas',
    '/mandalas/new',
    '/mandalas/abc-123',
    '/learning/m-1/v-1',
    '/settings',
    '/subscription',
    '/explore',
    '/admin',
    '/admin/users',
  ])('gates app route %s on mobile', (path) => {
    expect(isPathAllowedOnMobile(path)).toBe(false);
  });

  it('does not treat prefix-similar paths as allowed', () => {
    expect(isPathAllowedOnMobile('/helpcenter')).toBe(false);
    expect(isPathAllowedOnMobile('/pricing2')).toBe(false);
  });
});
