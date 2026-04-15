import { classifyQuality } from '../quality';

describe('classifyQuality', () => {
  const base = { title: 'Hello', durationSec: 600 };

  it('drops below bronze floor', () => {
    expect(classifyQuality({ ...base, viewCount: 999 })).toEqual({
      accepted: false,
      reason: 'below_view_floor',
    });
  });

  it('drops shorts', () => {
    expect(classifyQuality({ ...base, viewCount: 10_000, durationSec: 30 })).toEqual({
      accepted: false,
      reason: 'too_short',
    });
  });

  it('drops long-form > 1h', () => {
    expect(classifyQuality({ ...base, viewCount: 10_000, durationSec: 3601 })).toEqual({
      accepted: false,
      reason: 'too_long',
    });
  });

  it('drops missing metadata', () => {
    expect(classifyQuality({ ...base, viewCount: null })).toEqual({
      accepted: false,
      reason: 'missing_metadata',
    });
    expect(classifyQuality({ ...base, viewCount: 10_000, durationSec: null })).toEqual({
      accepted: false,
      reason: 'missing_metadata',
    });
  });

  it('drops title blocklist matches', () => {
    expect(classifyQuality({ ...base, title: '오늘의 브이로그', viewCount: 100_000 })).toEqual({
      accepted: false,
      reason: 'title_blocklist',
    });
  });

  it('classifies bronze [1K, 10K)', () => {
    expect(classifyQuality({ ...base, viewCount: 1_000 })).toEqual({
      accepted: true,
      tier: 'bronze',
    });
    expect(classifyQuality({ ...base, viewCount: 9_999 })).toEqual({
      accepted: true,
      tier: 'bronze',
    });
  });

  it('classifies silver [10K, 100K)', () => {
    expect(classifyQuality({ ...base, viewCount: 10_000 })).toEqual({
      accepted: true,
      tier: 'silver',
    });
    expect(classifyQuality({ ...base, viewCount: 99_999 })).toEqual({
      accepted: true,
      tier: 'silver',
    });
  });

  it('classifies gold [100K, ∞)', () => {
    expect(classifyQuality({ ...base, viewCount: 100_000 })).toEqual({
      accepted: true,
      tier: 'gold',
    });
    expect(classifyQuality({ ...base, viewCount: 10_000_000 })).toEqual({
      accepted: true,
      tier: 'gold',
    });
  });

  it('accepts boundary durations', () => {
    expect(classifyQuality({ ...base, viewCount: 10_000, durationSec: 60 })).toEqual({
      accepted: true,
      tier: 'silver',
    });
    expect(classifyQuality({ ...base, viewCount: 10_000, durationSec: 3600 })).toEqual({
      accepted: true,
      tier: 'silver',
    });
  });
});
