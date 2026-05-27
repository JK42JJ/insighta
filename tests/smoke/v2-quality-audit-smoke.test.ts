/**
 * v2 Quality Audit smoke gate (CP488+, 2026-05-27).
 *
 * Integration smoke: feeds a well-formed and a deliberately-hallucinated
 * fixture through `computeAuditScore` to verify the metric pipeline is
 * intact end-to-end. A regression in any of the 8 metric functions or
 * the violation-collection logic surfaces here before the PR can merge.
 *
 * Phase 1 scope note: the design doc §8 calls for a real LLM call against
 * a 10-min mock video. Implementing that requires extending the v2
 * generator's `V2GenerationInput` interface to accept `transcript` and
 * `mockYoutubeMetadata` overrides (the current entrypoint only takes
 * `videoId` and reads everything from the DB + caption extractor). That
 * refactor is tracked as Phase 1.5 — for now the fixture path catches
 * the highest-value regression class (audit logic drift).
 *
 * Cost: $0 (no LLM call). Smoke runs on every CI build regardless of
 * `V2_QUALITY_AUDIT_SMOKE_ENABLED`, so a regression cannot slip past.
 *
 * Design: docs/design/v2-quality-audit-system-2026-05-27.md §8.
 */

import { classifyScore, computeAuditScore } from '@/modules/skills/rich-summary-quality-audit';

// Well-formed fixture: matches the design doc's "10-minute video that
// passes" scenario. Sections tile end-to-end, atoms span the timeline,
// one-liner is short, timestamps are sorted.
const HAPPY_FIXTURE = {
  videoId: 'TEST_HAPPY_10MIN',
  durationSeconds: 600,
  oneliner: '시간 관리 핵심 원칙 세 가지',
  sections: [
    { from_sec: 0, to_sec: 120 },
    { from_sec: 120, to_sec: 300 },
    { from_sec: 300, to_sec: 480 },
    { from_sec: 480, to_sec: 600 },
  ],
  atoms: [
    { timestamp_sec: 30 },
    { timestamp_sec: 110 },
    { timestamp_sec: 200 },
    { timestamp_sec: 350 },
    { timestamp_sec: 450 },
    { timestamp_sec: 580 },
  ],
};

// Hallucinated fixture: modelled directly on the CP488+ XrlKWAIFQUY
// production incident. Sections extend past video duration, atoms
// timestamps are bunched in the first half, one-liner runs long.
const HALLUCINATED_FIXTURE = {
  videoId: 'TEST_HALLUCINATED_15MIN',
  durationSeconds: 901,
  oneliner: '암호화폐 세금 핵심 정리 매우 길고 자세한 영상 요약 내용',
  sections: [
    { from_sec: 210, to_sec: 600 },
    { from_sec: 700, to_sec: 1100 },
    { from_sec: 1100, to_sec: 1380 },
  ],
  atoms: [
    { timestamp_sec: 30 },
    { timestamp_sec: 90 },
    { timestamp_sec: 150 },
    { timestamp_sec: 220 },
    { timestamp_sec: 300 },
  ],
};

describe('v2 quality audit smoke', () => {
  const PASS = 85;
  const WARN = 70;

  it('happy fixture clears the pass threshold', () => {
    const result = computeAuditScore(HAPPY_FIXTURE, WARN);
    const classification = classifyScore(result.overall, PASS, WARN);

    expect(result.overall).toBeGreaterThanOrEqual(PASS);
    expect(classification).toBe('pass');
    expect(result.violations).toHaveLength(0);

    // Specific assertions on the metrics most prone to regression
    expect(result.m1RangeFit).toBe(100);
    expect(result.m2CoverageStart).toBe(100);
    expect(result.m6AtomsSorted).toBe(100);
  });

  it('hallucinated fixture (XrlKWAIFQUY shape) drops to critical', () => {
    const result = computeAuditScore(HALLUCINATED_FIXTURE, WARN);
    const classification = classifyScore(result.overall, PASS, WARN);

    expect(classification).toBe('critical');
    expect(result.overall).toBeLessThan(WARN);

    const violated = result.violations.map((v) => v.metric);
    expect(violated).toEqual(expect.arrayContaining(['m1_range_fit']));
    expect(violated).toEqual(expect.arrayContaining(['m2_coverage_start']));
  });

  it('violation entries include both score and human-readable detail', () => {
    const result = computeAuditScore(HALLUCINATED_FIXTURE, WARN);
    for (const v of result.violations) {
      expect(typeof v.metric).toBe('string');
      expect(typeof v.score).toBe('number');
      expect(typeof v.detail).toBe('string');
      expect(v.detail.length).toBeGreaterThan(0);
    }
  });
});
