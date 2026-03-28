/**
 * SummaryQualityGate Unit Tests
 *
 * Tests for Phase 1 rule-based quality validation.
 * Interface contract: check(summary) → { score, passed, action, reasons }
 */

import { checkSummaryQuality, type RichSummary } from '../../../src/modules/skills/summary-gate';

// ============================================================================
// Fixtures
// ============================================================================

function createValidSummary(overrides?: Partial<RichSummary>): RichSummary {
  return {
    core_argument: 'This video explains how to build a REST API with Node.js',
    key_points: ['Point 1', 'Point 2', 'Point 3'],
    evidence: ['Study shows 80% improvement'],
    actionables: ['Install Node.js', 'Create project'],
    prerequisites: ['Basic JavaScript'],
    bias_signals: [],
    content_type: 'tutorial',
    depth_level: 'beginner',
    mandala_fit: {
      suggested_topics: ['Node.js', 'REST API'],
      relevance_rationale: 'Directly relevant to backend development',
    },
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('checkSummaryQuality', () => {
  describe('valid summary — full score', () => {
    it('returns passed: true with score 1.0 for a complete valid summary', () => {
      const result = checkSummaryQuality(createValidSummary());
      expect(result.passed).toBe(true);
      expect(result.score).toBe(1.0);
      expect(result.action).toBe('use');
      expect(result.reasons).toHaveLength(0);
    });
  });

  describe('core_argument validation', () => {
    it('deducts 0.15 when core_argument is too short', () => {
      const result = checkSummaryQuality(createValidSummary({ core_argument: 'Short' }));
      expect(result.score).toBe(0.85);
      expect(result.reasons).toContainEqual(expect.stringContaining('core_argument length'));
    });

    it('deducts 0.15 when core_argument is too long (>100 chars)', () => {
      const longArg =
        'This is a very detailed and comprehensive argument about building scalable REST APIs with modern Node.js frameworks';
      expect(longArg.length).toBeGreaterThan(100);
      const result = checkSummaryQuality(createValidSummary({ core_argument: longArg }));
      expect(result.score).toBe(0.85);
    });

    it('deducts 0.15 when core_argument is missing', () => {
      const result = checkSummaryQuality(createValidSummary({ core_argument: undefined }));
      expect(result.score).toBe(0.85);
    });
  });

  describe('key_points validation', () => {
    it('deducts 0.15 when key_points has fewer than 3 items', () => {
      const result = checkSummaryQuality(createValidSummary({ key_points: ['One', 'Two'] }));
      expect(result.score).toBe(0.85);
      expect(result.reasons).toContainEqual(expect.stringContaining('key_points insufficient'));
    });

    it('passes with exactly 3 key_points', () => {
      const result = checkSummaryQuality(createValidSummary({ key_points: ['A', 'B', 'C'] }));
      expect(result.score).toBe(1.0);
    });
  });

  describe('actionables validation', () => {
    it('deducts 0.10 when actionables is empty', () => {
      const result = checkSummaryQuality(createValidSummary({ actionables: [] }));
      expect(result.score).toBe(0.9);
    });
  });

  describe('hallucination detection', () => {
    it('deducts 0.30 when "as an AI" pattern detected', () => {
      const result = checkSummaryQuality(
        createValidSummary({ core_argument: 'As an AI, I think this is great content here' })
      );
      expect(result.score).toBe(0.7);
      expect(result.reasons).toContainEqual(expect.stringContaining('hallucination'));
    });

    it('deducts 0.30 when repeated characters detected', () => {
      const result = checkSummaryQuality(
        createValidSummary({ core_argument: 'This is a valid argument aaaaaa yes' })
      );
      expect(result.score).toBe(0.7);
    });

    it('deducts 0.30 when Korean apology pattern detected', () => {
      const result = checkSummaryQuality(
        createValidSummary({
          core_argument: '죄송합니다 이 영상은 분석이 어렵습니다 하지만 시도합니다',
        })
      );
      expect(result.score).toBe(0.7);
    });
  });

  describe('bias_signals validation', () => {
    it('deducts 0.20 when bias_signals is not an array', () => {
      const result = checkSummaryQuality(createValidSummary({ bias_signals: undefined }));
      expect(result.score).toBe(0.8);
    });

    it('passes when bias_signals is an empty array', () => {
      const result = checkSummaryQuality(createValidSummary({ bias_signals: [] }));
      expect(result.score).toBe(1.0);
    });
  });

  describe('content_type and depth_level', () => {
    it('does not deduct for valid content_type and depth_level', () => {
      const result = checkSummaryQuality(
        createValidSummary({ content_type: 'research', depth_level: 'advanced' })
      );
      expect(result.score).toBe(1.0);
    });

    it('deducts 0.05 for invalid content_type', () => {
      const result = checkSummaryQuality(createValidSummary({ content_type: 'podcast' }));
      expect(result.score).toBe(0.95);
    });

    it('deducts 0.05 for invalid depth_level', () => {
      const result = checkSummaryQuality(createValidSummary({ depth_level: 'expert' }));
      expect(result.score).toBe(0.95);
    });
  });

  describe('threshold behavior', () => {
    it('returns passed: false when score < 0.7', () => {
      // Missing: core_argument(-0.15) + key_points(-0.15) + actionables(-0.10) = 0.60
      const result = checkSummaryQuality({
        bias_signals: [],
        content_type: 'tutorial',
        depth_level: 'beginner',
      });
      expect(result.passed).toBe(false);
      expect(result.action).toBe('retry');
      expect(result.score).toBeLessThan(0.7);
    });

    it('returns passed: true when score = 0.7 exactly', () => {
      // hallucination detected (-0.30) = 0.70
      const result = checkSummaryQuality(
        createValidSummary({
          core_argument: 'As an AI model I analyze this great content thoroughly',
        })
      );
      expect(result.score).toBe(0.7);
      expect(result.passed).toBe(true);
    });
  });

  describe('GateResult interface contract', () => {
    it('always returns score, passed, action, reasons', () => {
      const result = checkSummaryQuality({});
      expect(typeof result.score).toBe('number');
      expect(typeof result.passed).toBe('boolean');
      expect(['use', 'retry', 'fallback']).toContain(result.action);
      expect(Array.isArray(result.reasons)).toBe(true);
    });
  });
});
