/**
 * Unit tests for the timeline range validator (CP488+ Phase 1.5).
 *
 * The validator is what stops Sonnet 4.6's hallucinated over-shoot
 * outputs from being persisted as `quality_flag='pass'`. Phase 3
 * dogfooding (2026-05-27) confirmed the LLM produces `to_sec=1380`
 * against `duration=901` (53% over) — exactly the shape these tests
 * exercise.
 */

import {
  validateV2TimelineRange,
  V2TimelineRangeError,
} from '@/modules/skills/rich-summary-v2-validator-range';

describe('validateV2TimelineRange', () => {
  it('passes when sections + atoms fit within duration', () => {
    expect(() =>
      validateV2TimelineRange({
        durationSeconds: 600,
        sections: [{ to_sec: 200 }, { to_sec: 400 }, { to_sec: 595 }],
        atoms: [{ timestamp_sec: 100 }, { timestamp_sec: 400 }, { timestamp_sec: 580 }],
      })
    ).not.toThrow();
  });

  it('passes within the 5% tolerance band', () => {
    expect(() =>
      validateV2TimelineRange({
        durationSeconds: 1000,
        sections: [{ to_sec: 1040 }], // 1040 / 1000 = 1.04 ≤ 1.05
        atoms: [{ timestamp_sec: 1045 }],
      })
    ).not.toThrow();
  });

  it('throws when sections.last.to_sec exceeds duration × 1.05', () => {
    expect(() =>
      validateV2TimelineRange({
        durationSeconds: 901,
        sections: [{ to_sec: 1380 }], // XrlKWAIFQUY incident
      })
    ).toThrow(V2TimelineRangeError);
  });

  it('throws when atoms max timestamp exceeds duration × 1.05', () => {
    expect(() =>
      validateV2TimelineRange({
        durationSeconds: 600,
        atoms: [{ timestamp_sec: 100 }, { timestamp_sec: 1200 }],
      })
    ).toThrow(V2TimelineRangeError);
  });

  it('attaches the observed value + cap on the error', () => {
    let caught: V2TimelineRangeError | null = null;
    try {
      validateV2TimelineRange({
        durationSeconds: 1000,
        sections: [{ to_sec: 2000 }],
      });
    } catch (err) {
      if (err instanceof V2TimelineRangeError) caught = err;
    }
    expect(caught).not.toBeNull();
    expect(caught?.observed).toBe(2000);
    expect(caught?.maxAllowed).toBe(1050);
    expect(caught?.path).toBe('segments.sections.last.to_sec');
  });

  it('is a no-op when duration is unknown', () => {
    expect(() =>
      validateV2TimelineRange({
        durationSeconds: 0,
        sections: [{ to_sec: 9999 }],
      })
    ).not.toThrow();
    expect(() =>
      validateV2TimelineRange({
        durationSeconds: Number.NaN,
        sections: [{ to_sec: 9999 }],
      })
    ).not.toThrow();
  });

  it('ignores atoms without timestamp_sec', () => {
    expect(() =>
      validateV2TimelineRange({
        durationSeconds: 600,
        atoms: [{ timestamp_sec: null }, {}, { timestamp_sec: 580 }],
      })
    ).not.toThrow();
  });
});
