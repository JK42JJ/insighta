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
