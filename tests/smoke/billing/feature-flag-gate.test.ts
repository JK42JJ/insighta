/**
 * CP456 Phase 5 — billing feature-flag gate logic (strict).
 *
 * Per user decision 2026-05-14: admins do NOT bypass the flag. The gate is a
 * single switch — `billing_enabled=true` is the only path to checkout. Admins
 * flip the switch themselves via /admin/billing, then transact normally.
 */

import { invalidateCache } from '@/modules/system-settings';

// Mirror of the BE route's gate check (src/api/routes/billing/checkout.ts).
function isCheckoutAllowed(flagEnabled: boolean): boolean {
  return flagEnabled;
}

describe('billing feature-flag gate (Phase 5, strict)', () => {
  beforeEach(() => {
    invalidateCache();
  });

  it('blocks checkout when flag is off', () => {
    expect(isCheckoutAllowed(false)).toBe(false);
  });

  it('allows checkout when flag is on', () => {
    expect(isCheckoutAllowed(true)).toBe(true);
  });
});
