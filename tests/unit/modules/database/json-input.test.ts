import { toJsonInput } from '@/modules/database/json-input';

interface Shaped {
  keywords: Array<{ term: string; weight: number }>;
}

describe('toJsonInput', () => {
  it('returns the same reference, only widened for Prisma JSON columns', () => {
    const profile: Shaped = { keywords: [{ term: 'ml', weight: 0.5 }] };
    expect(toJsonInput(profile)).toBe(profile);
  });

  it('accepts typed arrays, which Prisma InputJsonValue does not take directly', () => {
    const violations: Array<{ code: string }> = [{ code: 'v1' }];
    expect(toJsonInput(violations)).toBe(violations);
  });
});
