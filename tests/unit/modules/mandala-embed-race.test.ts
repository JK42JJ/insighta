/**
 * CP504 — wizard goal-embed RACE (MANDALA_EMBED_RACE=true).
 *
 * The OpenRouter-only embed was a single point of failure: when OpenRouter ran
 * out of credits (402) the wizard "목표 분석" died at the embed step. The race
 * calls BOTH providers and takes the first to SUCCEED — cloud wins on speed in
 * the common case, Mac Mini Ollama survives the race if cloud dies.
 *
 * Per CLAUDE.md Hard Rule on LLM API usage, this test NEVER makes a real
 * OpenRouter/Ollama call — config is statically mocked and global fetch is
 * spied in every case. Providers are told apart by URL: OpenRouter hits
 * `…/embeddings`, Ollama hits `…/api/embed`. Each test uses a UNIQUE goal
 * string (the module-level goalEmbedCache is intentionally not reset).
 */

const mockConfig = {
  mandalaEmbed: {
    provider: 'openrouter' as const,
    race: true,
    openRouterBaseUrl: 'https://openrouter.test/api/v1',
    openRouterModel: 'qwen/qwen3-embedding-8b',
    openRouterDimension: 4096,
  },
  mandalaGen: {
    url: 'http://ollama.local:11434',
    model: 'mandala-gen',
    embedModel: 'qwen3-embedding:8b',
    embedDimension: 4096,
  },
  openrouter: { apiKey: 'test-key', model: 'qwen/qwen3-30b-a3b' },
};

jest.mock('../../../src/config', () => ({
  config: new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'mandalaEmbed') return mockConfig.mandalaEmbed;
        if (prop === 'mandalaGen') return mockConfig.mandalaGen;
        if (prop === 'openrouter') return mockConfig.openrouter;
        if (prop === 'app')
          return { env: 'test', isProduction: false, isTest: true, logLevel: 'silent' };
        return undefined;
      },
    }
  ),
}));

jest.mock('@/modules/database/client', () => ({ getPrismaClient: () => ({}) }));
jest.mock('@/utils/logger', () => ({
  logger: { child: () => ({ info: jest.fn(), warn: jest.fn() }), info: jest.fn(), warn: jest.fn() },
}));

import { embedGoalForMandala } from '../../../src/modules/mandala/search';

const VEC_OR = Array(4096).fill(0.002);
const VEC_OL = Array(4096).fill(0.003);
const orOk = () => new Response(JSON.stringify({ data: [{ embedding: VEC_OR }] }), { status: 200 });
const olOk = () => new Response(JSON.stringify({ embeddings: [VEC_OL] }), { status: 200 });
const isOpenRouter = (u: unknown) => String(u).includes('/embeddings');

afterEach(() => jest.restoreAllMocks());

describe('embedGoalForMandala race (CP504)', () => {
  it('calls BOTH providers; the fast one (OpenRouter) wins', async () => {
    const spy = jest.spyOn(globalThis, 'fetch').mockImplementation(async (u) => {
      if (isOpenRouter(u)) return orOk();
      await new Promise((r) => setTimeout(r, 40)); // Ollama is the slow loser
      return olOk();
    });
    const vec = await embedGoalForMandala('race both ok — cloud fast A');
    expect(vec[0]).toBe(0.002); // OpenRouter vector
    expect(spy).toHaveBeenCalledTimes(2); // both fired — Mac Mini still called
  });

  it('survives OpenRouter 402 — Mac Mini Ollama wins the race', async () => {
    jest.spyOn(globalThis, 'fetch').mockImplementation(async (u) => {
      if (isOpenRouter(u)) return new Response('Insufficient credits', { status: 402 });
      return olOk();
    });
    const vec = await embedGoalForMandala('race cloud-402 ollama-wins B');
    expect(vec[0]).toBe(0.003); // Ollama vector — wizard stays up
  });

  it('throws MandalaSearchError only when BOTH providers fail', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (u) =>
        isOpenRouter(u)
          ? new Response('402', { status: 402 })
          : new Response('500', { status: 500 })
      );
    await expect(embedGoalForMandala('race both fail C')).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
    });
  });
});
