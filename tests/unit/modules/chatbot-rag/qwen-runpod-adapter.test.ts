/**
 * tests/unit/modules/chatbot-rag/qwen-runpod-adapter.test.ts
 *
 * Unit tests for QwenRunpodAdapter (CP474 Phase B — Bug 1 fix).
 *
 * Coverage:
 *   - Constructor validation (baseURL, apiKey required)
 *   - Public properties: provider, model, name
 *   - getLanguageModel() returns chat.completions LanguageModel — NOT
 *     Responses API. This is the Bug 1 fix verification (mock createOpenAI
 *     and assert `.chat()` was called, not `provider(model)`).
 *   - process() filters non-text messages
 *   - process() streams text deltas (start → content → end events)
 *   - process() handles empty stream gracefully (no events)
 *   - process() propagates threadId or generates new UUID
 *
 * Mocks: OpenAI SDK + @ai-sdk/openai + @copilotkit/shared.
 */

const mockChatCompletionsCreate = jest.fn();

jest.mock('openai', () =>
  jest.fn().mockImplementation(() => ({
    chat: { completions: { create: mockChatCompletionsCreate } },
  }))
);

const mockChatModel = { __chatModel: true };
const mockResponsesModel = { __responsesModel: true };
const mockCreateOpenAI = jest.fn().mockImplementation(() => {
  const provider = jest.fn(() => mockResponsesModel);
  // Mimic @ai-sdk/openai's provider surface: provider(model) → Responses,
  // provider.chat(model) → Chat Completions, provider.responses(...) → Responses
  Object.assign(provider, {
    chat: jest.fn(() => mockChatModel),
    responses: jest.fn(() => mockResponsesModel),
  });
  return provider;
});

jest.mock('@ai-sdk/openai', () => ({
  createOpenAI: mockCreateOpenAI,
}));

jest.mock('@copilotkit/shared', () => ({
  randomUUID: () => 'mock-uuid-1234',
}));

// Mock the qwen prompt middleware so the adapter tests stay pure: no DB
// calls, no caption extractor, just identity rewriting.
jest.mock('@/modules/chatbot-rag/qwen-prompt-middleware', () => ({
  createQwenPromptMiddleware: jest.fn(() => ({ specificationVersion: 'v3' })),
  rewriteSystemContent: jest.fn(async (content: string) => content || 'REWRITTEN'),
}));

// Mock logger because the adapter imports it at module level.
jest.mock('@/utils/logger', () => {
  type Logger = {
    info: jest.Mock;
    warn: jest.Mock;
    error: jest.Mock;
    debug: jest.Mock;
    child: () => Logger;
  };
  const childLogger: Logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: () => childLogger,
  };
  return { logger: childLogger };
});

import { QwenRunpodAdapter } from '@/modules/chatbot-rag/qwen-runpod-adapter';

const BASE = 'https://abc-8000.proxy.runpod.net/openai/v1';
const KEY = '0123456789abcdef';

beforeEach(() => {
  jest.clearAllMocks();
  // Re-prime createOpenAI default behaviour
  mockCreateOpenAI.mockImplementation(() => {
    const provider = jest.fn(() => mockResponsesModel);
    Object.assign(provider, {
      chat: jest.fn(() => mockChatModel),
      responses: jest.fn(() => mockResponsesModel),
    });
    return provider;
  });
});

// ---------------------------------------------------------------------------
// Constructor + properties
// ---------------------------------------------------------------------------

describe('QwenRunpodAdapter — constructor', () => {
  it('throws when baseURL is empty', () => {
    expect(() => new QwenRunpodAdapter({ baseURL: '', apiKey: KEY })).toThrow(/baseURL/);
  });

  it('throws when apiKey is empty', () => {
    expect(() => new QwenRunpodAdapter({ baseURL: BASE, apiKey: '' })).toThrow(/apiKey/);
  });

  it('sets provider="qwen-runpod" and default model="insighta-chatbot"', () => {
    const a = new QwenRunpodAdapter({ baseURL: BASE, apiKey: KEY });
    expect(a.provider).toBe('qwen-runpod');
    expect(a.model).toBe('insighta-chatbot');
    expect(a.name).toBe('QwenRunpodAdapter');
  });

  it('accepts custom model override', () => {
    const a = new QwenRunpodAdapter({ baseURL: BASE, apiKey: KEY, model: 'custom-name' });
    expect(a.model).toBe('custom-name');
  });
});

// ---------------------------------------------------------------------------
// Bug 1 fix verification — getLanguageModel()
// ---------------------------------------------------------------------------

describe('QwenRunpodAdapter — getLanguageModel() (Bug 1 fix)', () => {
  it('uses createOpenAI({baseURL, apiKey}) for provider construction', () => {
    const a = new QwenRunpodAdapter({ baseURL: BASE, apiKey: KEY });
    a.getLanguageModel();

    expect(mockCreateOpenAI).toHaveBeenCalledWith({
      baseURL: BASE,
      apiKey: KEY,
    });
  });

  it('invokes provider.chat(model) — chat.completions endpoint (NOT Responses API)', () => {
    // This is the Bug 1 fix: provider.chat() forces /v1/chat/completions,
    // not provider(model) which would route to /v1/responses.
    let capturedProvider:
      | (jest.Mock & {
          chat: jest.Mock;
          responses: jest.Mock;
        })
      | null = null;
    mockCreateOpenAI.mockImplementationOnce(() => {
      const provider = jest.fn(() => mockResponsesModel);
      Object.assign(provider, {
        chat: jest.fn(() => mockChatModel),
        responses: jest.fn(() => mockResponsesModel),
      });
      capturedProvider = provider as unknown as typeof capturedProvider;
      return provider;
    });

    const a = new QwenRunpodAdapter({ baseURL: BASE, apiKey: KEY, model: 'm-1' });
    // Returns wrapLanguageModel-wrapped LanguageModel (not the raw chat model).
    // Identity isn't asserted; the critical assertion is that the chat
    // factory was called, NOT the default (Responses) factory.
    a.getLanguageModel();

    expect(capturedProvider!.chat).toHaveBeenCalledWith('m-1');
    // Critical: the default callable (Responses API) MUST NOT be invoked.
    expect(capturedProvider!).not.toHaveBeenCalled();
    expect(capturedProvider!.responses).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// process() streaming
// ---------------------------------------------------------------------------

function makeTextMessage(role: 'user' | 'assistant' | 'system', content: string) {
  return {
    isTextMessage: () => true,
    isActionExecutionMessage: () => false,
    isResultMessage: () => false,
    role,
    content,
  };
}

function makeNonTextMessage() {
  return {
    isTextMessage: () => false,
    isActionExecutionMessage: () => true,
    isResultMessage: () => false,
    role: 'assistant',
    content: '',
  };
}

function makeEventSource() {
  const calls: Array<{ method: string; args: unknown }> = [];
  const eventStream$ = {
    sendTextMessageStart: jest.fn((args) => calls.push({ method: 'start', args })),
    sendTextMessageContent: jest.fn((args) => calls.push({ method: 'content', args })),
    sendTextMessageEnd: jest.fn((args) => calls.push({ method: 'end', args })),
    sendActionExecutionStart: jest.fn(),
    sendActionExecutionEnd: jest.fn(),
    sendActionExecutionArgs: jest.fn(),
    complete: jest.fn(() => calls.push({ method: 'complete', args: undefined })),
  };
  // `done` resolves once the streaming handler completes. The adapter's
  // call to `eventSource.stream(...)` is fired-and-forget — process()
  // returns the threadId immediately while the handler runs in the
  // background. Tests must await `done` before asserting event order.
  let resolveDone!: () => void;
  const done = new Promise<void>((res) => {
    resolveDone = res;
  });
  return {
    eventStream$,
    calls,
    done,
    stream: jest.fn(async (handler: (es: typeof eventStream$) => Promise<void>) => {
      try {
        await handler(eventStream$);
      } finally {
        resolveDone();
      }
    }),
  };
}

async function* iterChunks(chunks: Array<{ id?: string; delta?: string }>) {
  for (const c of chunks) {
    yield { id: c.id ?? 'chunk-1', choices: [{ delta: { content: c.delta } }] };
  }
}

describe('QwenRunpodAdapter — process()', () => {
  it('forwards only text messages to chat.completions, with system message rewritten', async () => {
    mockChatCompletionsCreate.mockResolvedValueOnce(iterChunks([]));
    const a = new QwenRunpodAdapter({ baseURL: BASE, apiKey: KEY });
    const es = makeEventSource();

    await a.process({
      messages: [
        makeTextMessage('system', 'sys') as never,
        makeTextMessage('user', 'hi') as never,
        makeNonTextMessage() as never,
      ],
      actions: [],
      eventSource: es as never,
    });

    expect(mockChatCompletionsCreate).toHaveBeenCalledTimes(1);
    const callArg = mockChatCompletionsCreate.mock.calls[0]![0];
    // System message goes through rewriteSystemContent (mocked as identity);
    // non-system messages pass through untouched.
    expect(callArg.messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
    ]);
  });

  it('streams deltas as start → content → end → complete', async () => {
    mockChatCompletionsCreate.mockResolvedValueOnce(
      iterChunks([
        { id: 'c-1', delta: 'Hello' },
        { id: 'c-1', delta: ', world' },
      ])
    );
    const a = new QwenRunpodAdapter({ baseURL: BASE, apiKey: KEY });
    const es = makeEventSource();

    await a.process({
      messages: [makeTextMessage('user', 'hi') as never],
      actions: [],
      eventSource: es as never,
    });
    await es.done;

    const methods = es.calls.map((c) => c.method);
    expect(methods).toEqual(['start', 'content', 'content', 'end', 'complete']);

    expect(es.eventStream$.sendTextMessageContent).toHaveBeenNthCalledWith(1, {
      messageId: 'c-1',
      content: 'Hello',
    });
    expect(es.eventStream$.sendTextMessageContent).toHaveBeenNthCalledWith(2, {
      messageId: 'c-1',
      content: ', world',
    });
  });

  it('skips all message events when the stream is empty', async () => {
    mockChatCompletionsCreate.mockResolvedValueOnce(iterChunks([]));
    const a = new QwenRunpodAdapter({ baseURL: BASE, apiKey: KEY });
    const es = makeEventSource();

    await a.process({
      messages: [makeTextMessage('user', 'hi') as never],
      actions: [],
      eventSource: es as never,
    });
    await es.done;

    expect(es.eventStream$.sendTextMessageStart).not.toHaveBeenCalled();
    expect(es.eventStream$.sendTextMessageContent).not.toHaveBeenCalled();
    expect(es.eventStream$.sendTextMessageEnd).not.toHaveBeenCalled();
    expect(es.eventStream$.complete).toHaveBeenCalledTimes(1);
  });

  it('passes vLLM-specific chat_template_kwargs.enable_thinking=false', async () => {
    mockChatCompletionsCreate.mockResolvedValueOnce(iterChunks([]));
    const a = new QwenRunpodAdapter({ baseURL: BASE, apiKey: KEY });
    const es = makeEventSource();

    await a.process({
      messages: [makeTextMessage('user', 'hi') as never],
      actions: [],
      eventSource: es as never,
    });

    const callArg = mockChatCompletionsCreate.mock.calls[0]![0];
    expect(callArg.chat_template_kwargs).toEqual({ enable_thinking: false });
  });

  it('returns provided threadId when present', async () => {
    mockChatCompletionsCreate.mockResolvedValueOnce(iterChunks([]));
    const a = new QwenRunpodAdapter({ baseURL: BASE, apiKey: KEY });
    const es = makeEventSource();

    const result = await a.process({
      messages: [makeTextMessage('user', 'hi') as never],
      actions: [],
      eventSource: es as never,
      threadId: 'thread-abc',
    });

    expect(result.threadId).toBe('thread-abc');
  });

  it('generates a UUID threadId when not provided', async () => {
    mockChatCompletionsCreate.mockResolvedValueOnce(iterChunks([]));
    const a = new QwenRunpodAdapter({ baseURL: BASE, apiKey: KEY });
    const es = makeEventSource();

    const result = await a.process({
      messages: [makeTextMessage('user', 'hi') as never],
      actions: [],
      eventSource: es as never,
    });

    expect(result.threadId).toBe('mock-uuid-1234');
  });

  it('honours forwardedParameters.maxTokens + temperature when provided', async () => {
    mockChatCompletionsCreate.mockResolvedValueOnce(iterChunks([]));
    const a = new QwenRunpodAdapter({ baseURL: BASE, apiKey: KEY });
    const es = makeEventSource();

    await a.process({
      messages: [makeTextMessage('user', 'hi') as never],
      actions: [],
      eventSource: es as never,
      forwardedParameters: { maxTokens: 800, temperature: 0.5 },
    });

    const callArg = mockChatCompletionsCreate.mock.calls[0]![0];
    expect(callArg.max_completion_tokens).toBe(800);
    expect(callArg.temperature).toBe(0.5);
  });
});
