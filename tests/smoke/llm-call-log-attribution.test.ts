/**
 * #963 — llm_call_logs cost attribution.
 *
 * Verifies the videoId/userId passthrough lands on the llm_call_logs row
 * WITHOUT any real LLM call (fetch is mocked — the LLM-API hard rule holds):
 *   provider.generate(prompt, { videoId, userId })
 *     → logLLMCall({ videoId, userId })
 *     → prisma.llm_call_logs.create({ data: { video_id, user_id } })
 *
 * Lives in tests/smoke so CI actually executes it (ci.yml testPathPattern).
 */

const mockLlmLogCreate = jest.fn().mockResolvedValue({});

jest.mock('@/modules/database/client', () => ({
  getPrismaClient: () => ({
    llm_call_logs: { create: mockLlmLogCreate },
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
import { logLLMCall } from '../../src/modules/llm/call-logger';

const VIDEO = 'vidAttr12345';
const USER = 'bbbbbbbb-1111-2222-3333-dddddddddddd';

describe('#963 llm_call_logs attribution', () => {
  beforeEach(() => {
    mockLlmLogCreate.mockClear();
  });

  test('logLLMCall persists videoId/userId onto the row', async () => {
    await logLLMCall({
      module: 'openrouter',
      model: 'openrouter/test-model',
      status: 'success',
      videoId: VIDEO,
      userId: USER,
    });
    expect(mockLlmLogCreate).toHaveBeenCalledTimes(1);
    expect(mockLlmLogCreate.mock.calls[0]![0].data).toMatchObject({
      video_id: VIDEO,
      user_id: USER,
    });
  });

  test('logLLMCall without attribution stays NULL (additive default unchanged)', async () => {
    await logLLMCall({
      module: 'openrouter',
      model: 'openrouter/test-model',
      status: 'success',
    });
    expect(mockLlmLogCreate.mock.calls[0]![0].data).toMatchObject({
      video_id: null,
      user_id: null,
    });
  });

  test('provider.generate threads videoId/userId through to the log row (success path, fetch mocked)', async () => {
    const realFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: 'ok' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
      headers: { get: () => null },
      text: async () => '',
    }) as unknown as typeof fetch;
    try {
      const provider = new OpenRouterGenerationProvider('openrouter/test-model');
      await provider.generate('hello', { videoId: VIDEO, userId: USER });
      // fire-and-forget log write — flush microtasks
      await new Promise((r) => setTimeout(r, 10));
      expect(mockLlmLogCreate).toHaveBeenCalled();
      const rows = mockLlmLogCreate.mock.calls.map((c) => c[0].data);
      expect(rows.some((d) => d.video_id === VIDEO && d.user_id === USER)).toBe(true);
    } finally {
      global.fetch = realFetch;
    }
  });
});
