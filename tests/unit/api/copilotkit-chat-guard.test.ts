/**
 * Guards on the raw-HTTP chat listener (`/api/v1/chat`).
 *
 * The CopilotKit runtime is attached to the Node server directly, so none of
 * Fastify's auth or rate-limit plugins see these requests. Before this the
 * listener answered without a token (identity only enriched the prompt), had
 * no per-user ceiling, and wrote ledger rows with `user_id = null`. These pin
 * the order the listener now applies: identity, then the credit breaker, then
 * the per-user rate limit, then the runtime.
 *
 * The runtime, the provider adapters and the ledger client are mocked; the
 * listener, the JWT extraction and `checkUserRateLimit` are the real code.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';

const mockVerify = jest.fn();
const mockCount = jest.fn();
const mockFindFirst = jest.fn();
const mockHandler = jest.fn();
const mockGetChatbotSettings = jest.fn();

jest.mock('@copilotkit/runtime', () => ({
  CopilotRuntime: jest.fn().mockImplementation(() => ({})),
  OpenAIAdapter: jest.fn().mockImplementation(() => ({})),
  copilotRuntimeNodeHttpEndpoint: jest.fn(() => mockHandler),
}));

jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('@/modules/chatbot-rag', () => ({
  QwenRunpodAdapter: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('@/modules/chatbot-settings/service', () => ({
  getChatbotSettings: mockGetChatbotSettings,
}));

jest.mock('@/api/routes/copilotkit-provider-poller', () => ({
  getEffectiveProvider: () => 'openrouter',
  startProviderHealthPoller: jest.fn(),
}));

jest.mock('@/modules/database/client', () => ({
  getPrismaClient: () => ({
    llm_call_logs: { count: mockCount, findFirst: mockFindFirst },
  }),
}));

const USER_RATE_LIMIT_PER_HOUR = 2;

jest.mock('@/config/index', () => ({
  config: {
    chatbot: {
      provider: 'openrouter',
      model: undefined,
      localUrl: 'http://localhost:11434/v1',
      failoverEnabled: false,
      userRateLimitPerHour: 2,
    },
    openrouter: { apiKey: 'test-key' },
    ollama: { generateModel: 'llama' },
    qwenLora: { apiUrl: undefined, model: 'insighta-chatbot' },
    runpod: { apiKey: undefined },
    creditBreaker: { enabled: false },
    llm: { budgetGateEnabled: false },
  },
}));

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

import { copilotKitRoutes } from '@/api/routes/copilotkit';
import { getChatbotContext } from '@/api/routes/chatbot-context-storage';
import { CHAT_LEDGER_MODULE } from '@/modules/llm/ledger-modules';
import { MS_PER_MINUTE, MS_PER_SECOND } from '@/utils/time-constants';

type RequestListener = (req: IncomingMessage, res: ServerResponse) => void;

const originalListener = jest.fn();
let chatListener: RequestListener | undefined;

const fakeServer = {
  listeners: () => [originalListener],
  removeAllListeners: jest.fn(),
  on: (_event: string, fn: RequestListener) => {
    chatListener = fn;
  },
};

const fakeFastify = {
  server: fakeServer,
  jwt: { verify: mockVerify },
  addHook: jest.fn(),
  get: jest.fn(),
  authenticate: jest.fn(),
};

const VALID_CLAIMS = { sub: 'user-1', email: 'user@example.com' };
const HALF_HOUR_MS = 30 * MS_PER_MINUTE;
const CLOCK_TOLERANCE_SEC = 2;

function makeReq(opts: { method?: string; url?: string; authorization?: string } = {}) {
  const req = {
    url: opts.url ?? '/api/v1/chat',
    method: opts.method ?? 'POST',
    headers: opts.authorization ? { authorization: opts.authorization } : {},
    pause: jest.fn(),
    resume: jest.fn(),
  };
  return { req: req as unknown as IncomingMessage, raw: req };
}

function makeRes() {
  let finish: () => void = () => undefined;
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const headers: Record<string, string> = {};
  const raw = {
    statusCode: 200,
    headersSent: false,
    setHeader: jest.fn((name: string, value: string) => {
      headers[name.toLowerCase()] = value;
    }),
    end: jest.fn(() => {
      raw.headersSent = true;
      finish();
    }),
  };
  const body = (): Record<string, unknown> => {
    const first = raw.end.mock.calls[0] as unknown[] | undefined;
    return JSON.parse(String(first?.[0] ?? 'null')) as Record<string, unknown>;
  };
  return { res: raw as unknown as ServerResponse, raw, finished, headers, body };
}

function dispatch(req: IncomingMessage, res: ServerResponse): void {
  if (!chatListener) throw new Error('listener not registered');
  chatListener(req, res);
}

beforeAll(() => {
  copilotKitRoutes(fakeFastify as unknown as FastifyInstance, {}, () => undefined);
});

beforeEach(() => {
  jest.clearAllMocks();
  mockGetChatbotSettings.mockResolvedValue({
    updatedAt: new Date(0),
    qwenRunpodModel: null,
    openrouterModel: null,
  });
  mockVerify.mockReturnValue(VALID_CLAIMS);
  mockCount.mockResolvedValue(0);
  mockFindFirst.mockResolvedValue(null);
  mockHandler.mockImplementation(async (_req: IncomingMessage, res: ServerResponse) => {
    res.end('runtime');
  });
});

describe('identity guard', () => {
  it('answers 401 without a bearer token and never reaches the runtime', async () => {
    const { req, raw: rawReq } = makeReq();
    const { res, raw, finished, body } = makeRes();

    dispatch(req, res);
    await finished;

    expect(raw.statusCode).toBe(401);
    expect(body()).toEqual({ error: 'unauthorized', message: '로그인이 필요합니다.' });
    expect(mockVerify).not.toHaveBeenCalled();
    expect(mockHandler).not.toHaveBeenCalled();
    expect(mockCount).not.toHaveBeenCalled();
    expect(rawReq.pause).not.toHaveBeenCalled();
  });

  it('answers 401 for an Authorization header that is not a bearer token', async () => {
    const { req } = makeReq({ authorization: 'Basic abc' });
    const { res, raw, finished } = makeRes();

    dispatch(req, res);
    await finished;

    expect(raw.statusCode).toBe(401);
    expect(mockVerify).not.toHaveBeenCalled();
    expect(mockHandler).not.toHaveBeenCalled();
  });

  it('answers 401 when the token fails verification (expired or bad signature)', async () => {
    mockVerify.mockImplementation(() => {
      throw new Error('Access token has expired');
    });
    const { req } = makeReq({ authorization: 'Bearer expired.token' });
    const { res, raw, finished, body } = makeRes();

    dispatch(req, res);
    await finished;

    expect(raw.statusCode).toBe(401);
    expect(body()).toEqual({ error: 'unauthorized', message: '로그인이 필요합니다.' });
    expect(mockVerify).toHaveBeenCalledWith('expired.token');
    expect(mockHandler).not.toHaveBeenCalled();
    expect(mockCount).not.toHaveBeenCalled();
  });

  it('lets a CORS preflight through to the runtime without a token', async () => {
    const { req } = makeReq({ method: 'OPTIONS' });
    const { res, finished } = makeRes();

    dispatch(req, res);
    await finished;

    expect(mockVerify).not.toHaveBeenCalled();
    expect(mockCount).not.toHaveBeenCalled();
    expect(mockHandler).toHaveBeenCalledTimes(1);
  });
});

describe('per-user rate limit', () => {
  it('refuses with 429 and Retry-After once the count reaches the limit', async () => {
    mockCount.mockResolvedValue(USER_RATE_LIMIT_PER_HOUR);
    const oldestAt = new Date(Date.now() - HALF_HOUR_MS);
    mockFindFirst.mockResolvedValue({ created_at: oldestAt });
    const { req } = makeReq({ authorization: 'Bearer good.token' });
    const { res, raw, finished, headers, body } = makeRes();

    dispatch(req, res);
    await finished;

    expect(raw.statusCode).toBe(429);
    const expectedRetry = HALF_HOUR_MS / MS_PER_SECOND;
    const answer = body();
    expect(answer['error']).toBe('rate_limited');
    expect(answer['message']).toBe('시간당 질문 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.');
    expect(answer['retryAfterSec']).toBeGreaterThanOrEqual(expectedRetry - CLOCK_TOLERANCE_SEC);
    expect(answer['retryAfterSec']).toBeLessThanOrEqual(expectedRetry + CLOCK_TOLERANCE_SEC);
    expect(headers['retry-after']).toBe(String(answer['retryAfterSec']));
    expect(headers['content-type']).toBe('application/json');
    expect(mockHandler).not.toHaveBeenCalled();
  });

  it('counts by the verified user id and the chat module label', async () => {
    const { req } = makeReq({ authorization: 'Bearer good.token' });
    const { res, finished } = makeRes();

    dispatch(req, res);
    await finished;

    expect(mockCount).toHaveBeenCalledTimes(1);
    const arg = mockCount.mock.calls[0]?.[0] as {
      where: { user_id: string; module: string; created_at: { gt: Date } };
    };
    expect(arg.where.user_id).toBe('user-1');
    expect(arg.where.module).toBe(CHAT_LEDGER_MODULE);
    expect(arg.where.created_at.gt).toBeInstanceOf(Date);
  });

  it('serves the turn under the limit with the caller bound to the request context', async () => {
    mockCount.mockResolvedValue(USER_RATE_LIMIT_PER_HOUR - 1);
    let seen: ReturnType<typeof getChatbotContext>;
    mockHandler.mockImplementation(async (_req: IncomingMessage, res: ServerResponse) => {
      seen = getChatbotContext();
      res.end('runtime');
    });
    const { req, raw: rawReq } = makeReq({ authorization: 'Bearer good.token' });
    const { res, raw, finished } = makeRes();

    dispatch(req, res);
    await finished;

    expect(raw.statusCode).toBe(200);
    expect(mockHandler).toHaveBeenCalledTimes(1);
    expect(seen).toEqual({ userId: 'user-1', email: 'user@example.com', displayName: 'user' });
    expect(rawReq.pause).toHaveBeenCalledTimes(1);
    expect(rawReq.resume).toHaveBeenCalledTimes(1);
  });

  it('does not count the GET /info bootstrap against the limit', async () => {
    mockCount.mockResolvedValue(USER_RATE_LIMIT_PER_HOUR);
    const { req } = makeReq({
      method: 'GET',
      url: '/api/v1/chat/info',
      authorization: 'Bearer good.token',
    });
    const { res, raw, finished } = makeRes();

    dispatch(req, res);
    await finished;

    expect(raw.statusCode).toBe(200);
    expect(mockCount).not.toHaveBeenCalled();
    expect(mockHandler).toHaveBeenCalledTimes(1);
  });
});

describe('routing', () => {
  it('hands every other URL, including /api/v1/chat/config, to the Fastify listener', () => {
    const { res } = makeRes();

    dispatch(makeReq({ url: '/api/v1/health' }).req, res);
    dispatch(makeReq({ url: '/api/v1/chat/config', method: 'GET' }).req, res);

    expect(originalListener).toHaveBeenCalledTimes(2);
    expect(mockHandler).not.toHaveBeenCalled();
  });
});
