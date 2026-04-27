/**
 * Quality Metrics — unit tests for M1 (title overlap) + M3 (timestamp check) + combined score.
 */

import {
  measureTitleOverlap,
  extractContentTexts,
} from '../../src/modules/quality-metrics/title-overlap';
import { checkTimestamps } from '../../src/modules/quality-metrics/timestamp-check';
import { computeSpecificity } from '../../src/modules/quality-metrics/specificity-score';

// ============================================================================
// M1: measureTitleOverlap
// ============================================================================

describe('measureTitleOverlap', () => {
  it('returns overlap ratio for Korean title vs atom texts', () => {
    const title = '파이썬 머신러닝 입문 강좌';
    const texts = ['파이썬을 사용하여 머신러닝 모델을 학습합니다.', '입문자를 위한 기초 개념 설명'];
    const ratio = measureTitleOverlap(title, texts);
    // "파이썬", "머신러닝", "입문" should partially match (Korean particles prevent exact match for some)
    expect(ratio).toBeGreaterThan(0.2);
    expect(ratio).toBeLessThanOrEqual(1);
  });

  it('returns overlap ratio for English title', () => {
    const title = 'machine learning python tutorial beginners';
    const texts = [
      'This tutorial covers machine learning fundamentals using Python.',
      'Designed for beginners with no prior knowledge.',
    ];
    const ratio = measureTitleOverlap(title, texts);
    // "machine", "learning", "python", "tutorial", "beginners" — most should match
    expect(ratio).toBeGreaterThan(0.5);
    expect(ratio).toBeLessThanOrEqual(1);
  });

  it('returns 0 when content texts are empty', () => {
    const ratio = measureTitleOverlap('파이썬 강좌', []);
    expect(ratio).toBe(0);
  });

  it('returns 0 when title has only stopwords', () => {
    const ratio = measureTitleOverlap('the a an is', ['some content here']);
    expect(ratio).toBe(0);
  });
});

// ============================================================================
// M3: checkTimestamps
// ============================================================================

describe('checkTimestamps', () => {
  it('returns all_null when all atom timestamps are null', () => {
    const atoms = [{ timestamp_sec: null }, { timestamp_sec: null }, { timestamp_sec: null }];
    const result = checkTimestamps(atoms);
    expect(result.pattern).toBe('all_null');
    expect(result.nullRatio).toBe(1);
  });

  it('returns uniform_fake when intervals are all equal (60s each)', () => {
    const atoms = [
      { timestamp_sec: 0 },
      { timestamp_sec: 60 },
      { timestamp_sec: 120 },
      { timestamp_sec: 180 },
      { timestamp_sec: 240 },
    ];
    const result = checkTimestamps(atoms);
    expect(result.pattern).toBe('uniform_fake');
    expect(result.nullRatio).toBe(0);
  });

  it('returns real when intervals vary significantly', () => {
    const atoms = [
      { timestamp_sec: 5 },
      { timestamp_sec: 43 },
      { timestamp_sec: 91 },
      { timestamp_sec: 200 },
      { timestamp_sec: 310 },
    ];
    const result = checkTimestamps(atoms);
    expect(result.pattern).toBe('real');
    expect(result.nullRatio).toBe(0);
  });

  it('returns mixed with correct null ratio when some timestamps are null', () => {
    const atoms = [
      { timestamp_sec: 30 },
      { timestamp_sec: null },
      { timestamp_sec: 90 },
      { timestamp_sec: null },
    ];
    const result = checkTimestamps(atoms);
    expect(result.pattern).toBe('mixed');
    expect(result.nullRatio).toBeCloseTo(0.5);
  });

  it('returns no_atoms when atoms array is undefined', () => {
    const result = checkTimestamps(undefined);
    expect(result.pattern).toBe('no_atoms');
    expect(result.nullRatio).toBe(1);
  });

  it('returns no_atoms when atoms array is empty', () => {
    const result = checkTimestamps([]);
    expect(result.pattern).toBe('no_atoms');
    expect(result.nullRatio).toBe(1);
  });
});

// ============================================================================
// computeSpecificity
// ============================================================================

describe('computeSpecificity', () => {
  it('returns high specificity for V2 with real timestamps and matching title', () => {
    const title = 'Python machine learning tutorial';
    const structured = {
      core_argument: 'A practical guide to machine learning with Python.',
      atoms: [
        { text: 'Python is used for machine learning models.', timestamp_sec: 5 },
        { text: 'Tutorial covers scikit-learn basics.', timestamp_sec: 43 },
        { text: 'Real-world examples help beginners learn quickly.', timestamp_sec: 200 },
        { text: 'Advanced topics covered at the end.', timestamp_sec: 410 },
      ],
      tl_dr_en: 'A hands-on Python machine learning tutorial for beginners.',
    };

    const result = computeSpecificity(title, structured);
    expect(result).not.toBeNull();
    expect(result!.m3TimestampPattern).toBe('real');
    // M1 should be high (python, machine, learning, tutorial all match)
    expect(result!.m1TitleOverlap).toBeGreaterThan(0.4);
    // Combined score should be meaningful
    expect(result!.specificityScore).toBeGreaterThan(0.2);
  });

  it('returns low M3 score for V2 with uniform_fake timestamps', () => {
    const title = 'Python tutorial basics';
    const structured = {
      core_argument: 'Python tutorial for beginners.',
      atoms: [
        { text: 'Python basics explained.', timestamp_sec: 0 },
        { text: 'Variables and types in Python.', timestamp_sec: 60 },
        { text: 'Control flow in Python.', timestamp_sec: 120 },
        { text: 'Functions in Python.', timestamp_sec: 180 },
      ],
      tl_dr_en: 'Python basics tutorial.',
    };

    const result = computeSpecificity(title, structured);
    expect(result).not.toBeNull();
    expect(result!.m3TimestampPattern).toBe('uniform_fake');
    // specificity_score = M1 * 0.55 + 0 * 0.45 — M3 contributes 0
    expect(result!.specificityScore).toBeCloseTo(result!.m1TitleOverlap * 0.55, 5);
  });

  it('uses only M1 for V1 summaries (no atoms)', () => {
    const title = '파이썬 머신러닝 강좌';
    const structured = {
      core_argument: '파이썬으로 머신러닝을 배우는 강좌입니다.',
      key_points: ['파이썬 기초 문법 설명', '머신러닝 알고리즘 소개', '실습 예제 제공'],
    };

    const result = computeSpecificity(title, structured);
    expect(result).not.toBeNull();
    expect(result!.m3TimestampPattern).toBe('no_atoms');
    // V1 → specificityScore === m1TitleOverlap
    expect(result!.specificityScore).toBeCloseTo(result!.m1TitleOverlap, 10);
  });

  it('returns null for null structured input', () => {
    const result = computeSpecificity('some title', null);
    expect(result).toBeNull();
  });

  it('returns null for empty structured object', () => {
    const result = computeSpecificity('some title', {});
    expect(result).toBeNull();
  });
});

// ============================================================================
// extractContentTexts
// ============================================================================

describe('extractContentTexts', () => {
  it('extracts V2 atom texts', () => {
    const structured = {
      atoms: [{ text: 'Atom one.' }, { text: 'Atom two.' }],
    };
    const texts = extractContentTexts(structured);
    expect(texts).toContain('Atom one.');
    expect(texts).toContain('Atom two.');
  });

  it('extracts V1 key_points as strings', () => {
    const structured = {
      key_points: ['Point A', 'Point B'],
    };
    const texts = extractContentTexts(structured);
    expect(texts).toContain('Point A');
    expect(texts).toContain('Point B');
  });

  it('includes core_argument, tl_dr_ko, tl_dr_en', () => {
    const structured = {
      core_argument: 'Core thesis.',
      tl_dr_ko: '핵심 요약.',
      tl_dr_en: 'Core summary.',
    };
    const texts = extractContentTexts(structured);
    expect(texts).toContain('Core thesis.');
    expect(texts).toContain('핵심 요약.');
    expect(texts).toContain('Core summary.');
  });
});
