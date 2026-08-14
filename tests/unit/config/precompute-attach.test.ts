import {
  isPrecomputeAttachEnabled,
  ATTACH_BUDGET_MS,
  ATTACH_INFLIGHT_MAX_AGE_MS,
} from '@/config/precompute-attach';

describe('isPrecomputeAttachEnabled', () => {
  it('defaults to false when unset (legacy re-run behavior)', () => {
    expect(isPrecomputeAttachEnabled({} as NodeJS.ProcessEnv)).toBe(false);
  });
  it('enables on true/1/yes', () => {
    expect(
      isPrecomputeAttachEnabled({ PRECOMPUTE_ATTACH_ENABLED: 'true' } as NodeJS.ProcessEnv)
    ).toBe(true);
    expect(isPrecomputeAttachEnabled({ PRECOMPUTE_ATTACH_ENABLED: '1' } as NodeJS.ProcessEnv)).toBe(
      true
    );
    expect(
      isPrecomputeAttachEnabled({ PRECOMPUTE_ATTACH_ENABLED: 'yes' } as NodeJS.ProcessEnv)
    ).toBe(true);
  });
  it('stays off on other values', () => {
    expect(
      isPrecomputeAttachEnabled({ PRECOMPUTE_ATTACH_ENABLED: 'false' } as NodeJS.ProcessEnv)
    ).toBe(false);
  });
  it('keeps the inflight skip window well below the watcher budget (no dead-end)', () => {
    expect(ATTACH_INFLIGHT_MAX_AGE_MS).toBeLessThan(ATTACH_BUDGET_MS);
  });
});
