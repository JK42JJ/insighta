/**
 * book-gate (§1③ / §0.3 D3 selection gate) — pure gate decision + config.
 * Locks: absolute keep>=min / drop<min (defect-2 rel=5) / null→passNull, AND the
 * CP504 relative mode (per-mandala median+ ∧ floor, tie-pass, small-mandala
 * fallback) + computeMandalaMedian.
 */

import {
  passesBookGate,
  passesBookGateOrBookmarked,
  computeMandalaMedian,
  loadBookGateConfig,
  isBookTopicSynthesisEnabled,
  loadNoteMaxSections,
  type BookGateConfig,
  type BookGateContext,
} from '../../../src/config/book-gate';

const cfg = (over: Partial<BookGateConfig> = {}): BookGateConfig => ({
  mode: 'absolute',
  minRelevance: 50,
  floorRelevance: 35,
  minScoredForRelative: 5,
  passNull: true,
  ...over,
});
// Absolute mode ignores ctx; relative tests pass an explicit one.
const NO_CTX: BookGateContext = { median: null, scoredCount: 0 };

describe('passesBookGate — absolute (legacy, default)', () => {
  it('keeps a card scored at/above the min', () => {
    expect(passesBookGate(50, NO_CTX, cfg())).toBe(true);
    expect(passesBookGate(92, NO_CTX, cfg())).toBe(true);
  });
  it('drops a card scored below the min (defect 2: rel=5 stock video)', () => {
    expect(passesBookGate(5, NO_CTX, cfg())).toBe(false);
    expect(passesBookGate(49, NO_CTX, cfg())).toBe(false);
  });
  it('null relevance follows passNull policy', () => {
    expect(passesBookGate(null, NO_CTX, cfg({ passNull: true }))).toBe(true);
    expect(passesBookGate(null, NO_CTX, cfg({ passNull: false }))).toBe(false);
  });
  it('min=0 disables the gate (everything scored passes)', () => {
    expect(passesBookGate(0, NO_CTX, cfg({ minRelevance: 0 }))).toBe(true);
  });
});

describe('passesBookGate — relative (CP504 §0.3 D3)', () => {
  const rel = cfg({ mode: 'relative', floorRelevance: 35, minScoredForRelative: 5 });
  const ctx = (median: number | null, scoredCount = 10): BookGateContext => ({
    median,
    scoredCount,
  });

  it('keeps cards at/above the mandala median (tie-pass)', () => {
    expect(passesBookGate(72, ctx(72), rel)).toBe(true); // == median passes (tie)
    expect(passesBookGate(85, ctx(72), rel)).toBe(true);
  });
  it('drops cards below the mandala median', () => {
    expect(passesBookGate(60, ctx(72), rel)).toBe(false);
  });
  it('floor overrides relative: below floor drops even if above median', () => {
    // weak mandala (median 30): a 32 card beats the median but is below floor 35
    expect(passesBookGate(32, ctx(30), rel)).toBe(false);
    expect(passesBookGate(40, ctx(30), rel)).toBe(true); // above floor AND median
  });
  it('tight cluster: all-equal scores all pass (>= median, no arbitrary cut)', () => {
    // a mandala of [78,78,78,78,82] → median 78 → every 78 passes
    expect(passesBookGate(78, ctx(78), rel)).toBe(true);
    expect(passesBookGate(82, ctx(78), rel)).toBe(true);
  });
  it('small-mandala fallback: too few scored ⇒ absolute min, not median', () => {
    // scoredCount 3 < 5 ⇒ absolute: 60 >= min(50) passes regardless of median 72
    expect(passesBookGate(60, ctx(72, 3), rel)).toBe(true);
    expect(passesBookGate(45, ctx(72, 3), rel)).toBe(false); // below absolute min
  });
  it('null median ⇒ absolute fallback', () => {
    expect(passesBookGate(60, ctx(null, 10), rel)).toBe(true);
  });
  it('null relevance still follows passNull in relative mode', () => {
    expect(passesBookGate(null, ctx(72), rel)).toBe(true);
    expect(passesBookGate(null, ctx(72), cfg({ mode: 'relative', passNull: false }))).toBe(false);
  });
});

describe('computeMandalaMedian', () => {
  it('odd count → middle, excludes nulls', () => {
    const c = computeMandalaMedian([40, null, 80, null, 60]);
    expect(c.median).toBe(60);
    expect(c.scoredCount).toBe(3);
  });
  it('even count → mean of the two middles', () => {
    expect(computeMandalaMedian([60, 80, 70, 90]).median).toBe(75);
  });
  it('no scored cards → null median', () => {
    expect(computeMandalaMedian([null, null])).toEqual({ median: null, scoredCount: 0 });
  });
});

describe('loadBookGateConfig', () => {
  it('defaults: mode absolute, min 70, floor 35, minScored 5, passNull true (inert)', () => {
    const c = loadBookGateConfig({});
    expect(c).toEqual({
      mode: 'absolute',
      // default moved 40 → 70 in PR #1038 (src/config/book-gate.ts:48 — book targets 핵심+추천 only)
      minRelevance: 70,
      floorRelevance: 35,
      minScoredForRelative: 5,
      passNull: true,
    });
  });
  it('env flips to relative + overrides floor/minScored/null policy', () => {
    const c = loadBookGateConfig({
      BOOK_GATE_MODE: 'relative',
      BOOK_GATE_FLOOR_RELEVANCE: '30',
      BOOK_GATE_MIN_SCORED_FOR_RELATIVE: '8',
      BOOK_GATE_PASS_NULL_RELEVANCE: 'false',
    });
    expect(c.mode).toBe('relative');
    expect(c.floorRelevance).toBe(30);
    expect(c.minScoredForRelative).toBe(8);
    expect(c.passNull).toBe(false);
  });
});

describe('isBookTopicSynthesisEnabled — default ON', () => {
  it('unset ⇒ true (default on)', () => {
    expect(isBookTopicSynthesisEnabled({})).toBe(true);
  });
  it('only explicit false/0/no disables (rollback)', () => {
    expect(isBookTopicSynthesisEnabled({ BOOK_TOPIC_SYNTHESIS_ENABLED: 'false' })).toBe(false);
    expect(isBookTopicSynthesisEnabled({ BOOK_TOPIC_SYNTHESIS_ENABLED: '0' })).toBe(false);
    expect(isBookTopicSynthesisEnabled({ BOOK_TOPIC_SYNTHESIS_ENABLED: 'no' })).toBe(false);
  });
  it('true/anything-else ⇒ enabled', () => {
    expect(isBookTopicSynthesisEnabled({ BOOK_TOPIC_SYNTHESIS_ENABLED: 'true' })).toBe(true);
  });
});

describe('loadNoteMaxSections — CP504 §1⑤ surface-fix #3', () => {
  it('defaults to 20 when unset', () => {
    expect(loadNoteMaxSections({})).toBe(20);
  });
  it('reads a positive env override (floored)', () => {
    expect(loadNoteMaxSections({ NOTE_MAX_SECTIONS: '12' })).toBe(12);
    expect(loadNoteMaxSections({ NOTE_MAX_SECTIONS: '25.9' })).toBe(25);
  });
  it('falls back to 20 on invalid / non-positive', () => {
    expect(loadNoteMaxSections({ NOTE_MAX_SECTIONS: 'abc' })).toBe(20);
    expect(loadNoteMaxSections({ NOTE_MAX_SECTIONS: '0' })).toBe(20);
    expect(loadNoteMaxSections({ NOTE_MAX_SECTIONS: '-5' })).toBe(20);
  });
});

describe('passesBookGateOrBookmarked — bookmark exception', () => {
  it('bookmarked card stays in the book even below the gate min (and when unscored)', () => {
    expect(passesBookGateOrBookmarked(10, true, NO_CTX, cfg({ minRelevance: 50 }))).toBe(true);
    expect(passesBookGateOrBookmarked(null, true, NO_CTX, cfg({ passNull: false }))).toBe(true);
  });
  it('non-bookmarked card still obeys the relevance gate', () => {
    expect(passesBookGateOrBookmarked(10, false, NO_CTX, cfg({ minRelevance: 50 }))).toBe(false);
    expect(passesBookGateOrBookmarked(60, false, NO_CTX, cfg({ minRelevance: 50 }))).toBe(true);
  });
});
