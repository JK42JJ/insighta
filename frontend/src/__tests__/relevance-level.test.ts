import { describe, it, expect } from 'vitest';
import {
  relevanceLevel,
  relevanceBars,
  relevanceCssVar,
  RELEVANCE_HIGH_MIN,
  RELEVANCE_MID_MIN,
} from '@/pages/learning/lib/relevance-level';

describe('relevanceLevel', () => {
  it('maps boundaries to tiers (>=80 high / >=50 mid / <50 low)', () => {
    expect(relevanceLevel(100)).toBe('high');
    expect(relevanceLevel(RELEVANCE_HIGH_MIN)).toBe('high');
    expect(relevanceLevel(RELEVANCE_HIGH_MIN - 1)).toBe('mid');
    expect(relevanceLevel(RELEVANCE_MID_MIN)).toBe('mid');
    expect(relevanceLevel(RELEVANCE_MID_MIN - 1)).toBe('low');
    expect(relevanceLevel(0)).toBe('low');
  });

  it('lights 3/2/1 meter bars by tier', () => {
    expect(relevanceBars('high')).toBe(3);
    expect(relevanceBars('mid')).toBe(2);
    expect(relevanceBars('low')).toBe(1);
  });

  it('resolves the token var per tier', () => {
    expect(relevanceCssVar('high')).toBe('var(--lp-rel-high)');
    expect(relevanceCssVar('mid')).toBe('var(--lp-rel-mid)');
    expect(relevanceCssVar('low')).toBe('var(--lp-rel-low)');
  });
});
