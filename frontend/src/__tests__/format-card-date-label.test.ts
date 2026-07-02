import { describe, it, expect } from 'vitest';
import { formatCardDateLabel } from '@/shared/lib/format-date';

const DAY = 24 * 60 * 60 * 1000;

describe('formatCardDateLabel — honest publish-vs-added labels', () => {
  it('renders the publish date plainly when present', () => {
    const twoMonthsAgo = new Date(Date.now() - 61 * DAY);
    expect(formatCardDateLabel(twoMonthsAgo, new Date())).toBe('2 months ago');
  });

  it('marks the createdAt fallback as "added …" — never disguised as a publish date', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * DAY);
    expect(formatCardDateLabel(null, threeDaysAgo)).toBe('added 3 days ago');
  });

  it('returns null when neither date exists (slot stays empty)', () => {
    expect(formatCardDateLabel(null, null)).toBeNull();
  });
});
