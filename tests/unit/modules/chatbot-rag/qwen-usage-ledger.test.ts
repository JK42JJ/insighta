/**
 * tests/unit/modules/chatbot-rag/qwen-usage-ledger.test.ts
 *
 * The chat ledger recorded nothing. Every `llm_call_logs` write from the
 * chatbot failed with "Argument `input_tokens`: Expected Int or Null, provided
 * Object", because the AI SDK reports usage as objects, not counts. The shapes
 * below are the ones production actually emitted on 2026-09-16, copied from
 * the rejected insert in the API pod log.
 *
 * These tests fail if the middleware goes back to passing the SDK's field
 * straight through.
 */

import {
  usageTokenCount,
  usageCachedInputTokens,
} from '@/modules/chatbot-rag/qwen-prompt-middleware';

/** Verbatim from the rejected insert, `openrouter/google/gemini-2.5-flash`. */
const PROD_INPUT = { total: 3844, noCache: 799, cacheRead: 3045, cacheWrite: 0 };
const PROD_OUTPUT = { total: 38, text: 38, reasoning: 0 };

describe('usageTokenCount', () => {
  it('reads the count out of the object shape the SDK sends', () => {
    expect(usageTokenCount(PROD_INPUT)).toBe(3844);
    expect(usageTokenCount(PROD_OUTPUT)).toBe(38);
  });

  it('still accepts a plain number, which older SDK builds report', () => {
    expect(usageTokenCount(1234)).toBe(1234);
    expect(usageTokenCount(0)).toBe(0);
  });

  it('returns undefined rather than a value the column would reject', () => {
    expect(usageTokenCount(undefined)).toBeUndefined();
    expect(usageTokenCount(null)).toBeUndefined();
    expect(usageTokenCount({})).toBeUndefined();
    expect(usageTokenCount({ total: 'many' })).toBeUndefined();
    expect(usageTokenCount(NaN)).toBeUndefined();
    expect(usageTokenCount({ total: NaN })).toBeUndefined();
  });

  it('never returns an object, which is the defect itself', () => {
    expect(typeof usageTokenCount(PROD_INPUT)).toBe('number');
  });
});

describe('usageCachedInputTokens', () => {
  it('reports the cached portion, the field that answers whether caching works', () => {
    expect(usageCachedInputTokens(PROD_INPUT)).toBe(3045);
  });

  it('reports zero as zero, distinct from absent', () => {
    expect(usageCachedInputTokens({ total: 100, cacheRead: 0 })).toBe(0);
  });

  it('is undefined when the provider said nothing about caching', () => {
    // A number-shaped usage carries no cache information. Undefined is not
    // zero: "no caching on this model" and "the cache missed" are different.
    expect(usageCachedInputTokens(1234)).toBeUndefined();
    expect(usageCachedInputTokens(undefined)).toBeUndefined();
    expect(usageCachedInputTokens({ total: 100 })).toBeUndefined();
  });
});
