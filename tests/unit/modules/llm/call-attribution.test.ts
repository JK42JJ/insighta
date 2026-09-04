/**
 * Every LLM call says which stage made it, and how much of it was cached.
 *
 * The 2026-09-04 audit could not answer "what did the money go on". Five of
 * thirty-four call sites passed `purpose`, so 45,476 calls — $131.69, 89% of
 * everything spent — carried the single label `openrouter`. The ledger knew
 * the total and nothing else.
 *
 * `purpose` is required at the type level now, which is the only thing that
 * makes a new call site answer the question; a lint rule can be added to a
 * baseline and a comment can be skipped.
 *
 * `cachedInputTokens` is the other half. Prompt caching was the top item on
 * the savings list and could not be sized, because the ledger recorded how
 * many prompt tokens went out and not how many the provider already had.
 * OpenRouter has returned that number the whole time.
 */

const mockCreate = jest.fn();

jest.mock('@/modules/database/client', () => ({
  getPrismaClient: () => ({ llm_call_logs: { create: mockCreate } }),
}));

jest.mock('@/utils/logger', () => ({
  logger: {
    child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
  },
}));

import { logLLMCall } from '@/modules/llm/call-logger';

beforeEach(() => {
  jest.clearAllMocks();
  mockCreate.mockResolvedValue({});
});

function written() {
  return mockCreate.mock.calls[0]?.[0]?.data;
}

describe('the ledger row', () => {
  it('records the stage that made the call, not the provider', async () => {
    await logLLMCall({
      module: 'discover_query_gen',
      model: 'openrouter/anthropic/claude-haiku-4.5',
      status: 'success',
      inputTokens: 900,
      outputTokens: 40,
    });
    expect(written().module).toBe('discover_query_gen');
  });

  it('records cached prompt tokens when the provider reports them', async () => {
    await logLLMCall({
      module: 'summary_v2_full',
      model: 'openrouter/anthropic/claude-haiku-4.5',
      status: 'success',
      inputTokens: 3000,
      cachedInputTokens: 2048,
      outputTokens: 100,
    });
    expect(written().cached_input_tokens).toBe(2048);
  });

  it('writes null, not zero, when the provider reports nothing', async () => {
    await logLLMCall({
      module: 'card_relevance',
      model: 'openrouter/qwen/qwen3-30b-a3b',
      status: 'success',
      inputTokens: 500,
      outputTokens: 20,
    });
    // Zero would say "the cache missed". Null says "nobody mentioned a cache".
    // Telling those apart is the whole reason the column exists.
    expect(written().cached_input_tokens).toBeNull();
  });

  it('keeps a reported zero as zero', async () => {
    await logLLMCall({
      module: 'card_relevance',
      model: 'openrouter/anthropic/claude-haiku-4.5',
      status: 'success',
      inputTokens: 500,
      cachedInputTokens: 0,
      outputTokens: 20,
    });
    expect(written().cached_input_tokens).toBe(0);
  });
});
