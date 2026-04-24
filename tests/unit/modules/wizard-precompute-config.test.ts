/**
 * Wizard Precompute config — feature flag parsing (CP424.2).
 */

import { loadWizardPrecomputeConfig } from '../../../src/config/wizard-precompute';

describe('loadWizardPrecomputeConfig', () => {
  it('defaults to disabled when env unset', () => {
    expect(loadWizardPrecomputeConfig({})).toEqual({ enabled: false });
  });

  it.each([
    ['true', true],
    ['TRUE', true],
    ['1', true],
    ['yes', true],
    [' true ', true],
    ['false', false],
    ['0', false],
    ['', false],
    ['anything', false],
  ])('WIZARD_PRECOMPUTE_ENABLED=%s → enabled=%s', (raw, expected) => {
    expect(loadWizardPrecomputeConfig({ WIZARD_PRECOMPUTE_ENABLED: raw })).toEqual({
      enabled: expected,
    });
  });
});
