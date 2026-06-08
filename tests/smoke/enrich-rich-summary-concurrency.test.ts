/**
 * CP498 PR2 — enrich-rich-summary worker concurrency WIRING assert.
 *
 * ⚠️ Wiring check, NOT activation proof. `teamRefill` is new to the codebase and
 * "option present ≠ activated" (CP475 5→10 was a no-op with teamSize:1). The
 * activation gate is the LIVE measurement (observed max concurrency 1→N +
 * burst-span drop), not this test. Lives in tests/smoke so CI actually runs it
 * (CI = `jest --testPathPattern=tests/smoke`).
 */

import { richSummaryWorkOptions } from '@/modules/queue/handlers/rich-summary-work-options';

describe('richSummaryWorkOptions (CP498 PR2 wiring)', () => {
  it('returns symmetric teamSize/teamConcurrency = N and teamRefill:true', () => {
    expect(richSummaryWorkOptions(4)).toEqual({
      teamConcurrency: 4,
      teamSize: 4,
      teamRefill: true,
    });
  });

  it('teamRefill is always true — the flag teamSize:1 alone lacked (no-op cause)', () => {
    expect(richSummaryWorkOptions(1).teamRefill).toBe(true);
    expect(richSummaryWorkOptions(8).teamSize).toBe(8);
  });
});
