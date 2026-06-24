/**
 * llm-pricing — the v2 (Sonnet) model id must be in the table so cost_usd is
 * populated (it was NULL for all 327/30d v2 calls because the pinned id
 * 'anthropic/claude-sonnet-4-6' was missing). Real tokens × official price.
 */
import { calculateCost, LLM_PRICING } from '../../src/config/llm-pricing';

describe('llm-pricing — v2 Sonnet cost', () => {
  it('the v2 generator model id is priced ($3/M in, $15/M out)', () => {
    expect(LLM_PRICING['anthropic/claude-sonnet-4-6']).toBeDefined();
    // avg v2 call (measured): 12120 in, 5022 out → $0.1117
    const cost = calculateCost('openrouter/anthropic/claude-sonnet-4-6', 12120, 5022);
    expect(cost).not.toBeNull();
    expect(cost).toBeCloseTo(0.1117, 4);
  });

  it('Haiku relevance scoring is priced (1 call)', () => {
    const cost = calculateCost('openrouter/anthropic/claude-haiku-4.5', 1164, 230);
    expect(cost).toBeCloseTo(0.001164 + 0.00115, 5); // $1/M in + $5/M out
  });

  it('unknown model → null (does not fabricate a cost)', () => {
    expect(calculateCost('openrouter/some/unlisted-model', 100, 100)).toBeNull();
  });
});
