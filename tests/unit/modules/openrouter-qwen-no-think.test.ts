/**
 * W2 (CP499+) — prompt-level `/no_think` for Qwen models.
 *
 * generate() already sends `reasoning: {enabled:false}` for qwen models, but
 * some OpenRouter providers IGNORE the param (prod 2026-06-10: reasoning-only
 * 1024-token-cap responses + 20-48s latencies despite it). The Qwen
 * chat-template soft switch `/no_think` holds at the template layer,
 * provider-agnostic. Flag-gated: OPENROUTER_QWEN_NO_THINK unset = exactly the
 * pre-W2 request body (CLAUDE.md env-default rule).
 */

const mockConfig = {
  openrouter: {
    apiKey: 'test-key',
    model: 'qwen/qwen3-30b-a3b',
    qwenNoThink: false as boolean | undefined,
  },
};

jest.mock('@/config/index', () => ({ config: mockConfig }));
jest.mock('@/modules/llm/call-logger', () => ({ logLLMCall: jest.fn(() => Promise.resolve()) }));

import { OpenRouterGenerationProvider } from '@/modules/llm/openrouter';

interface CapturedBody {
  messages: Array<{ content: string }>;
  reasoning?: { enabled: boolean };
}

function fetchCapturingPrompt(): { sentPrompt: () => string; sentBody: () => CapturedBody } {
  const calls: CapturedBody[] = [];
  global.fetch = jest.fn().mockImplementation(async (_url: unknown, init: { body: string }) => {
    calls.push(JSON.parse(init.body) as CapturedBody);
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'ok' } }], usage: {} }),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  const body = (): CapturedBody => {
    if (!calls[0]) throw new Error('fetch was never called');
    return calls[0];
  };
  return {
    sentPrompt: () => body().messages[0]!.content,
    sentBody: body,
  };
}

afterEach(() => {
  jest.restoreAllMocks();
  mockConfig.openrouter.qwenNoThink = false;
});

describe('OpenRouterGenerationProvider — qwen /no_think suppression (W2)', () => {
  it('flag ON + qwen model → prompt gets the /no_think suffix', async () => {
    mockConfig.openrouter.qwenNoThink = true;
    const cap = fetchCapturingPrompt();
    await new OpenRouterGenerationProvider('qwen/qwen3-30b-a3b').generate('summarize this');
    expect(cap.sentPrompt()).toBe('summarize this\n/no_think');
    // the param-level suppression stays alongside
    expect(cap.sentBody().reasoning).toEqual({ enabled: false });
  });

  it('flag ON + non-qwen model → prompt untouched (and no reasoning param)', async () => {
    mockConfig.openrouter.qwenNoThink = true;
    const cap = fetchCapturingPrompt();
    await new OpenRouterGenerationProvider('anthropic/claude-haiku-4.5').generate('summarize this');
    expect(cap.sentPrompt()).toBe('summarize this');
    expect(cap.sentBody().reasoning).toBeUndefined();
  });

  it('flag ON + prompt already carrying /no_think (chatbot middleware) → no duplicate', async () => {
    mockConfig.openrouter.qwenNoThink = true;
    const cap = fetchCapturingPrompt();
    await new OpenRouterGenerationProvider('qwen/qwen3-30b-a3b').generate('chat turn\n/no_think');
    expect(cap.sentPrompt()).toBe('chat turn\n/no_think');
  });

  it('flag OFF (default/unset) → request body is exactly pre-W2', async () => {
    mockConfig.openrouter.qwenNoThink = undefined;
    const cap = fetchCapturingPrompt();
    await new OpenRouterGenerationProvider('qwen/qwen3-30b-a3b').generate('summarize this');
    expect(cap.sentPrompt()).toBe('summarize this');
    expect(cap.sentBody().reasoning).toEqual({ enabled: false });
  });
});
