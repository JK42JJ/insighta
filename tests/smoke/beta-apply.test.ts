import { normalizeBetaEmail } from '../../src/api/routes/beta';

describe('normalizeBetaEmail', () => {
  it('normalizes case and whitespace', () => {
    expect(normalizeBetaEmail('  Jamie@Example.COM ')).toBe('jamie@example.com');
  });

  it('accepts a plain valid address', () => {
    expect(normalizeBetaEmail('user+beta@insighta.one')).toBe('user+beta@insighta.one');
  });

  it.each(['', '   ', 'no-at-sign', 'a@b', 'a@b.c', 'spaces in@mail.com', 42, null, undefined])(
    'rejects invalid input %p',
    (input) => {
      expect(normalizeBetaEmail(input as never)).toBeNull();
    }
  );

  it('rejects overlong addresses', () => {
    expect(normalizeBetaEmail(`${'a'.repeat(250)}@example.com`)).toBeNull();
  });
});

// Gate config defaults must preserve current behavior (open signup = no-op).
import { BETA_DEFAULTS } from '../../src/modules/system-settings';

describe('beta gate defaults (regression: unset store = open, no-op)', () => {
  it('defaults signup to open so an unconfigured store never blocks signup', () => {
    expect(BETA_DEFAULTS.signupMode).toBe('open');
  });
  it('defaults phase to pre_launch', () => {
    expect(BETA_DEFAULTS.phase).toBe('pre_launch');
  });
  it('has a valid 6-week window (start Mon 2026-07-13, end 2026-08-24)', () => {
    const start = Date.parse(BETA_DEFAULTS.window.start);
    const end = Date.parse(BETA_DEFAULTS.window.end);
    expect(end - start).toBe(42 * 24 * 60 * 60 * 1000);
  });
});
