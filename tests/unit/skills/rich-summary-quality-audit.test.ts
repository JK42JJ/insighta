/**
 * Unit tests for v2 quality audit scoring (CP488+).
 *
 * Each metric is tested with a representative happy path + 1-2 boundary
 * cases so a regression in any single metric surfaces at the unit level.
 * The XrlKWAIFQUY incident (duration 901s, sections to 1380s) is captured
 * as a real-world acceptance case under `acceptance scenarios`.
 */

import {
  classifyScore,
  computeAuditScore,
  computeM1RangeFit,
  computeM2CoverageStart,
  computeM3CoverageEnd,
  computeM4AtomsRange,
  computeM5AtomsDistribution,
  computeM6AtomsSorted,
  computeM7SectionsGap,
  computeM8OneLinerLen,
} from '@/modules/skills/rich-summary-quality-audit';

describe('rich-summary-quality-audit', () => {
  describe('M1 range fit', () => {
    it('returns 100 when sections.last.to_sec matches duration', () => {
      expect(
        computeM1RangeFit({
          videoId: 'a',
          durationSeconds: 600,
          sections: [{ from_sec: 0, to_sec: 600 }],
        })
      ).toBe(100);
    });

    it('returns 0 for the XrlKWAIFQUY-style 53% over-shoot', () => {
      // duration 901s, sections to 1380s → ratio 1.53 ≥ 1.5 → 0
      const score = computeM1RangeFit({
        videoId: 'XrlKWAIFQUY',
        durationSeconds: 901,
        sections: [{ from_sec: 0, to_sec: 1380 }],
      });
      expect(score).toBe(0);
    });

    it('returns null when sections are missing', () => {
      expect(computeM1RangeFit({ videoId: 'a', durationSeconds: 600, sections: [] })).toBeNull();
    });

    it('returns null when duration is unknown', () => {
      expect(
        computeM1RangeFit({
          videoId: 'a',
          durationSeconds: null,
          sections: [{ from_sec: 0, to_sec: 600 }],
        })
      ).toBeNull();
    });
  });

  describe('M2 coverage start', () => {
    it('returns 100 when first section starts at 0', () => {
      expect(
        computeM2CoverageStart({
          videoId: 'a',
          durationSeconds: 600,
          sections: [{ from_sec: 0, to_sec: 100 }],
        })
      ).toBe(100);
    });

    it('returns 0 when first section starts at 180s+', () => {
      expect(
        computeM2CoverageStart({
          videoId: 'a',
          durationSeconds: 900,
          sections: [{ from_sec: 200, to_sec: 300 }],
        })
      ).toBe(0);
    });

    it('returns 100 for the boundary value 60s', () => {
      expect(
        computeM2CoverageStart({
          videoId: 'a',
          durationSeconds: 900,
          sections: [{ from_sec: 60, to_sec: 200 }],
        })
      ).toBe(100);
    });
  });

  describe('M3 coverage end', () => {
    it('returns 100 when last section ends near duration', () => {
      expect(
        computeM3CoverageEnd({
          videoId: 'a',
          durationSeconds: 600,
          sections: [{ from_sec: 0, to_sec: 590 }],
        })
      ).toBe(100);
    });

    it('drops below 100 when last section ends 20% short', () => {
      const score = computeM3CoverageEnd({
        videoId: 'a',
        durationSeconds: 600,
        sections: [{ from_sec: 0, to_sec: 480 }],
      });
      expect(score).not.toBeNull();
      expect(score!).toBeLessThan(100);
      expect(score!).toBeGreaterThan(0);
    });
  });

  describe('M4 atoms range', () => {
    it('returns 100 when atoms.max.timestamp_sec is within 0.85–1.05 of duration', () => {
      expect(
        computeM4AtomsRange({
          videoId: 'a',
          durationSeconds: 1000,
          atoms: [{ timestamp_sec: 100 }, { timestamp_sec: 500 }, { timestamp_sec: 950 }],
        })
      ).toBe(100);
    });

    it('returns 0 when atoms only cover early portion (<30%)', () => {
      expect(
        computeM4AtomsRange({
          videoId: 'a',
          durationSeconds: 1000,
          atoms: [{ timestamp_sec: 100 }, { timestamp_sec: 250 }],
        })
      ).toBe(0);
    });
  });

  describe('M5 atoms distribution', () => {
    it('returns 100 for evenly distributed atoms (normalized stddev ≈ 0.5)', () => {
      const score = computeM5AtomsDistribution({
        videoId: 'a',
        durationSeconds: 600,
        atoms: [
          { timestamp_sec: 50 },
          { timestamp_sec: 150 },
          { timestamp_sec: 300 },
          { timestamp_sec: 450 },
          { timestamp_sec: 550 },
        ],
      });
      expect(score).not.toBeNull();
      expect(score!).toBeGreaterThanOrEqual(80);
    });

    it('returns null for too few atoms', () => {
      expect(
        computeM5AtomsDistribution({
          videoId: 'a',
          durationSeconds: 600,
          atoms: [{ timestamp_sec: 100 }, { timestamp_sec: 200 }],
        })
      ).toBeNull();
    });
  });

  describe('M6 atoms sorted', () => {
    it('returns 100 for ascending timestamps', () => {
      expect(
        computeM6AtomsSorted({
          videoId: 'a',
          durationSeconds: 600,
          atoms: [{ timestamp_sec: 0 }, { timestamp_sec: 100 }, { timestamp_sec: 500 }],
        })
      ).toBe(100);
    });

    it('returns 0 for unsorted timestamps', () => {
      expect(
        computeM6AtomsSorted({
          videoId: 'a',
          durationSeconds: 600,
          atoms: [{ timestamp_sec: 100 }, { timestamp_sec: 50 }, { timestamp_sec: 500 }],
        })
      ).toBe(0);
    });

    it('skips atoms without timestamps', () => {
      expect(
        computeM6AtomsSorted({
          videoId: 'a',
          durationSeconds: 600,
          atoms: [{ timestamp_sec: 0 }, {}, { timestamp_sec: 500 }],
        })
      ).toBe(100);
    });
  });

  describe('M7 sections gap', () => {
    it('returns 100 for end-to-end tiled sections', () => {
      expect(
        computeM7SectionsGap({
          videoId: 'a',
          durationSeconds: 600,
          sections: [
            { from_sec: 0, to_sec: 200 },
            { from_sec: 200, to_sec: 400 },
            { from_sec: 400, to_sec: 600 },
          ],
        })
      ).toBe(100);
    });

    it('returns 0 for sections with >5% total gap', () => {
      expect(
        computeM7SectionsGap({
          videoId: 'a',
          durationSeconds: 600,
          sections: [
            { from_sec: 0, to_sec: 100 },
            { from_sec: 200, to_sec: 300 }, // 100s gap
            { from_sec: 300, to_sec: 600 },
          ],
        })
      ).toBe(0);
    });

    it('penalises overlapping sections too', () => {
      const score = computeM7SectionsGap({
        videoId: 'a',
        durationSeconds: 600,
        sections: [
          { from_sec: 0, to_sec: 250 },
          { from_sec: 200, to_sec: 400 }, // overlap of 50
          { from_sec: 400, to_sec: 600 },
        ],
      });
      expect(score).not.toBeNull();
      expect(score!).toBeLessThan(100);
    });
  });

  describe('M8 one-liner length', () => {
    it('returns 100 for one-liner ≤20 chars', () => {
      expect(
        computeM8OneLinerLen({ videoId: 'a', durationSeconds: 600, oneliner: '한 줄 요약입니다' })
      ).toBe(100);
    });

    it('returns 0 for one-liner ≥30 chars', () => {
      const long = '이것은 너무 긴 한 줄 요약입니다 정말로 길어요 너무 길어';
      expect(computeM8OneLinerLen({ videoId: 'a', durationSeconds: 600, oneliner: long })).toBe(0);
    });

    it('returns 0 for empty one-liner', () => {
      expect(computeM8OneLinerLen({ videoId: 'a', durationSeconds: 600, oneliner: '   ' })).toBe(0);
    });

    it('returns null when oneliner missing', () => {
      expect(computeM8OneLinerLen({ videoId: 'a', durationSeconds: 600 })).toBeNull();
    });
  });

  describe('computeAuditScore — overall + violations', () => {
    it('returns 0 overall when no metrics can compute', () => {
      const result = computeAuditScore({ videoId: 'a', durationSeconds: null });
      expect(result.overall).toBe(0);
      expect(result.violations).toEqual([]);
    });

    it('averages only non-null metrics', () => {
      const result = computeAuditScore({
        videoId: 'a',
        durationSeconds: 600,
        sections: [{ from_sec: 0, to_sec: 600 }],
        oneliner: '짧은 요약',
      });
      // M1=100, M2=100, M3=100, M8=100; M4-M7 null
      // M7 needs ≥2 sections to compute; M5/M6 need ≥3 atoms.
      // → average of 4 = 100
      expect(result.overall).toBe(100);
      expect(result.violations).toEqual([]);
    });

    it('flags violations below the warning threshold', () => {
      // M1 = 0 (over-shoot), M2 = 0 (late start), M4 = 0 (atoms bunched early)
      const result = computeAuditScore(
        {
          videoId: 'XrlKWAIFQUY',
          durationSeconds: 901,
          sections: [{ from_sec: 210, to_sec: 1380 }],
          atoms: [{ timestamp_sec: 25 }, { timestamp_sec: 150 }, { timestamp_sec: 220 }],
          oneliner: '암호화폐 절세 방법 3가지',
        },
        70
      );
      const violatedMetrics = result.violations.map((v) => v.metric).sort();
      expect(violatedMetrics).toEqual(
        expect.arrayContaining(['m1_range_fit', 'm2_coverage_start', 'm4_atoms_range'])
      );
      expect(result.overall).toBeLessThan(70);
    });
  });

  describe('classifyScore', () => {
    it('returns pass when score >= passThreshold', () => {
      expect(classifyScore(90, 85, 70)).toBe('pass');
      expect(classifyScore(85, 85, 70)).toBe('pass');
    });

    it('returns warning when score is between thresholds', () => {
      expect(classifyScore(75, 85, 70)).toBe('warning');
      expect(classifyScore(70, 85, 70)).toBe('warning');
    });

    it('returns critical when score < warningThreshold', () => {
      expect(classifyScore(69, 85, 70)).toBe('critical');
      expect(classifyScore(0, 85, 70)).toBe('critical');
    });
  });

  describe('acceptance: XrlKWAIFQUY 15:01 video (CP488+ incident)', () => {
    it('classifies the real broken row as critical', () => {
      // From prod DB query in CP488+ session:
      // duration_seconds=901, sections range 0–1380s, atoms max ts 1260s
      const result = computeAuditScore({
        videoId: 'XrlKWAIFQUY',
        durationSeconds: 901,
        sections: [
          { from_sec: 0, to_sec: 240 },
          { from_sec: 240, to_sec: 600 },
          { from_sec: 600, to_sec: 900 },
          { from_sec: 900, to_sec: 1380 },
        ],
        atoms: [
          { timestamp_sec: 25 },
          { timestamp_sec: 200 },
          { timestamp_sec: 500 },
          { timestamp_sec: 800 },
          { timestamp_sec: 1260 },
        ],
        oneliner: '암호화폐 세금 핵심 정리',
      });
      const classification = classifyScore(result.overall, 85, 70);
      expect(classification).toBe('critical');
      // M1 over-shoots so badly (1380/901 = 1.53) it crosses the 1.5
      // cap → score 0. M4 (atoms max 1260/901 = 1.398) sits in the
      // linear penalty band, scoring low but not exactly 0.
      expect(result.m1RangeFit).toBe(0);
      expect(result.m4AtomsRange).not.toBeNull();
      expect(result.m4AtomsRange!).toBeLessThan(70);
    });
  });
});
