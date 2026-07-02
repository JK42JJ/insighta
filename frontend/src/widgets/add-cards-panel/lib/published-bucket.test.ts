import { describe, it, expect } from 'vitest';
import { isoToPublishedBucket, MS_PER_DAY } from './published-bucket';

const NOW = Date.parse('2026-07-03T00:00:00.000Z');
const daysAgo = (d: number) => new Date(NOW - d * MS_PER_DAY).toISOString();

describe('isoToPublishedBucket — shared publish-period mapping', () => {
  it('maps each preset ISO back to its own bucket (round-trip)', () => {
    expect(isoToPublishedBucket(daysAgo(7), NOW)).toBe('7');
    expect(isoToPublishedBucket(daysAgo(30), NOW)).toBe('30');
    expect(isoToPublishedBucket(daysAgo(180), NOW)).toBe('180');
    expect(isoToPublishedBucket(daysAgo(365), NOW)).toBe('365');
    // the 2026-07-03 defect: 730d rendered as the 365 bucket ("지난 1년")
    expect(isoToPublishedBucket(daysAgo(730), NOW)).toBe('730');
    expect(isoToPublishedBucket(daysAgo(1095), NOW)).toBe('1095');
  });

  it('boundary days fall into the nearest preset', () => {
    expect(isoToPublishedBucket(daysAgo(366), NOW)).toBe('365');
    expect(isoToPublishedBucket(daysAgo(367), NOW)).toBe('730');
    expect(isoToPublishedBucket(daysAgo(731), NOW)).toBe('730');
    expect(isoToPublishedBucket(daysAgo(732), NOW)).toBe('1095');
    expect(isoToPublishedBucket(daysAgo(4000), NOW)).toBe('1095');
  });

  it('invalid ISO → empty bucket (any time)', () => {
    expect(isoToPublishedBucket('not-a-date', NOW)).toBe('');
  });
});
