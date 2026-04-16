import {
  DEFAULT_POOL_LIMIT,
  MAX_POOL_LIMIT,
  buildConnectionUrl,
  getPoolLimit,
} from '@/modules/database/connection-url';

describe('getPoolLimit', () => {
  test('defaults when env is unset', () => {
    expect(getPoolLimit(undefined)).toBe(DEFAULT_POOL_LIMIT);
    expect(getPoolLimit('')).toBe(DEFAULT_POOL_LIMIT);
  });

  test('accepts valid integers within range', () => {
    expect(getPoolLimit('1')).toBe(1);
    expect(getPoolLimit('5')).toBe(5);
    expect(getPoolLimit('10')).toBe(10);
    expect(getPoolLimit(String(MAX_POOL_LIMIT))).toBe(MAX_POOL_LIMIT);
  });

  test('falls back to default on out-of-range or invalid input', () => {
    expect(getPoolLimit('0')).toBe(DEFAULT_POOL_LIMIT);
    expect(getPoolLimit('-3')).toBe(DEFAULT_POOL_LIMIT);
    expect(getPoolLimit(String(MAX_POOL_LIMIT + 1))).toBe(DEFAULT_POOL_LIMIT);
    expect(getPoolLimit('abc')).toBe(DEFAULT_POOL_LIMIT);
    expect(getPoolLimit('5.7')).toBe(5); // parseInt accepts '5.7' as 5
    expect(getPoolLimit('NaN')).toBe(DEFAULT_POOL_LIMIT);
  });
});

describe('buildConnectionUrl — replace existing connection_limit', () => {
  test('replaces connection_limit=1 (prod case)', () => {
    const input =
      'postgresql://u:p@aws.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1';
    const out = buildConnectionUrl(input, 5);
    expect(out).toBe(
      'postgresql://u:p@aws.supabase.com:6543/postgres?pgbouncer=true&connection_limit=5'
    );
  });

  test('replaces connection_limit when it is the only query param', () => {
    const input = 'postgresql://u:p@host:5432/db?connection_limit=3';
    expect(buildConnectionUrl(input, 10)).toBe('postgresql://u:p@host:5432/db?connection_limit=10');
  });

  test('preserves other query params around connection_limit', () => {
    const input = 'postgresql://u:p@host:6543/db?pgbouncer=true&connection_limit=1&schema=public';
    expect(buildConnectionUrl(input, 7)).toBe(
      'postgresql://u:p@host:6543/db?pgbouncer=true&connection_limit=7&schema=public'
    );
  });
});

describe('buildConnectionUrl — append when missing', () => {
  test('appends with ? when URL has no query string', () => {
    const input = 'postgresql://u:p@host:5432/db';
    expect(buildConnectionUrl(input, 5)).toBe('postgresql://u:p@host:5432/db?connection_limit=5');
  });

  test('appends with & when URL has other query params', () => {
    const input = 'postgresql://u:p@host:6543/db?pgbouncer=true';
    expect(buildConnectionUrl(input, 5)).toBe(
      'postgresql://u:p@host:6543/db?pgbouncer=true&connection_limit=5'
    );
  });
});

describe('buildConnectionUrl — edge cases', () => {
  test('returns empty input unchanged', () => {
    expect(buildConnectionUrl('', 5)).toBe('');
    expect(buildConnectionUrl(undefined, 5)).toBe('');
  });

  test('does not touch a connection_limit substring that is not a query param', () => {
    // Pathological: "connection_limit" appearing inside a password or path
    // segment should not be treated as the query param to replace.
    const input = 'postgresql://connection_limit=99:p@host:5432/db?pgbouncer=true';
    const out = buildConnectionUrl(input, 5);
    // Password stays intact; appended at end because no ?/&connection_limit=N
    expect(out).toBe(
      'postgresql://connection_limit=99:p@host:5432/db?pgbouncer=true&connection_limit=5'
    );
  });
});
