/**
 * cost_usd 단가 갭 (v2 비용 묶음) — the iks-embed-fallback model must price.
 *
 * 30d prod: module=iks-embed-fallback, model=openrouter/qwen/qwen3-embedding-8b,
 * 1,368 token-bearing calls with cost_usd 100% NULL — calculateCost returned
 * null because the model was absent from LLM_PRICING. This pins the entry and
 * the exact call-logger normalization path (openrouter/ prefix strip).
 */

import { calculateCost, LLM_PRICING } from '../../src/config/llm-pricing';

describe('llm-pricing — qwen3-embedding-8b entry', () => {
  test('entry exists with the embeddings-catalog price', () => {
    const p = LLM_PRICING['qwen/qwen3-embedding-8b'];
    expect(p).toBeDefined();
    expect(p!.inputPerToken).toBe(0.00000001);
    expect(p!.outputPerToken).toBe(0);
  });

  test('calculateCost prices the PREFIXED model id exactly as call-logger passes it', () => {
    // call-logger receives entry.model verbatim ('openrouter/qwen/qwen3-embedding-8b');
    // calculateCost strips the provider prefix before the table lookup.
    const cost = calculateCost('openrouter/qwen/qwen3-embedding-8b', 1_000_000, 0);
    expect(cost).toBeCloseTo(0.01, 10); // $0.01 per 1M input tokens
  });

  test('unknown model still returns null (NULL contract unchanged)', () => {
    expect(calculateCost('openrouter/some/unknown-model', 100, 100)).toBeNull();
  });
});
