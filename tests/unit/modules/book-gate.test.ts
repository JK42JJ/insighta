/**
 * book-gate (§1③ selection gate) — pure gate decision + config.
 * Locks: keep >= min, drop < min (defect-2 rel=5 case), null → passNull policy.
 */

import {
  passesBookGate,
  loadBookGateConfig,
  isBookTopicSynthesisEnabled,
  type BookGateConfig,
} from '../../../src/config/book-gate';

const cfg = (over: Partial<BookGateConfig> = {}): BookGateConfig => ({
  minRelevance: 50,
  passNull: true,
  ...over,
});

describe('passesBookGate', () => {
  it('keeps a card scored at/above the min', () => {
    expect(passesBookGate(50, cfg())).toBe(true);
    expect(passesBookGate(92, cfg())).toBe(true);
  });

  it('drops a card scored below the min (defect 2: rel=5 stock video)', () => {
    expect(passesBookGate(5, cfg())).toBe(false);
    expect(passesBookGate(49, cfg())).toBe(false);
  });

  it('null relevance follows passNull policy', () => {
    expect(passesBookGate(null, cfg({ passNull: true }))).toBe(true);
    expect(passesBookGate(null, cfg({ passNull: false }))).toBe(false);
  });

  it('min=0 disables the gate (everything scored passes)', () => {
    expect(passesBookGate(0, cfg({ minRelevance: 0 }))).toBe(true);
    expect(passesBookGate(5, cfg({ minRelevance: 0 }))).toBe(true);
  });
});

describe('loadBookGateConfig', () => {
  it('defaults: min 40, passNull true', () => {
    const c = loadBookGateConfig({});
    expect(c.minRelevance).toBe(40);
    expect(c.passNull).toBe(true);
  });

  it('env overrides threshold + null policy', () => {
    const c = loadBookGateConfig({
      BOOK_GATE_MIN_RELEVANCE: '70',
      BOOK_GATE_PASS_NULL_RELEVANCE: 'false',
    });
    expect(c.minRelevance).toBe(70);
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
