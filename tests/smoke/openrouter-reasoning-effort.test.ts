/**
 * The reasoning effort option reaches the OpenRouter request body, and is
 * absent when not asked for. fetch is mocked: no real LLM call is made (the
 * LLM-API hard rule holds). Lives in tests/smoke so CI executes it.
 */

jest.mock('@/modules/database/client', () => ({
  getPrismaClient: () => ({
    llm_call_logs: { create: jest.fn().mockResolvedValue({}) },
  }),
}));

jest.mock('@/config/index', () => {
  const actual = jest.requireActual('@/config/index');
  return {
    ...actual,
    config: {
      ...actual.config,
      openrouter: { ...actual.config.openrouter, apiKey: 'test-key' },
    },
  };
});

import { OpenRouterGenerationProvider } from '../../src/modules/llm/openrouter';

async function sentBody(options: Record<string, unknown>): Promise<Record<string, unknown>> {
  const realFetch = global.fetch;
  const mock = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }),
    headers: { get: () => null },
    text: async () => '',
  });
  global.fetch = mock as unknown as typeof fetch;
  try {
    const provider = new OpenRouterGenerationProvider('deepseek/deepseek-v4-flash');
    await provider.generate('hello', { purpose: 'test', ...options });
    const init = mock.mock.calls[0]![1] as { body: string };
    return JSON.parse(init.body) as Record<string, unknown>;
  } finally {
    global.fetch = realFetch;
  }
}

describe('OpenRouter reasoning effort', () => {
  test('sends reasoning.effort when the caller asks for it', async () => {
    const body = await sentBody({ reasoningEffort: 'low' });
    expect(body['reasoning']).toEqual({ effort: 'low' });
  });

  test('sends no reasoning field for a non-qwen model when not asked', async () => {
    const body = await sentBody({});
    expect(body).not.toHaveProperty('reasoning');
  });
});
