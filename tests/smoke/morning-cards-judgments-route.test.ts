import Fastify, { FastifyInstance } from 'fastify';
import { createMorningCardsRoutes } from '@/api/routes/morning-cards';
import type { MorningCardsDb } from '@/modules/morning-cards/source';
import type { JudgmentDb } from '@/modules/morning-cards/judgment-repo';

export {};

const ENV_KEYS = ['MOBILE_MORNING_CARDS', 'MORNING_CARDS_TEST_USER_IDS'] as const;
const URL = '/api/v1/morning-cards/judgments';
const VALID = {
  video_id: 'abcdefghijk',
  domain: 'ai_tools',
  verdict: 'useful',
  shown_position: 2,
};

async function build(userId: string, create: jest.Mock): Promise<FastifyInstance> {
  const app = Fastify();
  app.decorate('authenticate', async (request: any) => {
    request.user = { userId };
  });
  const judgmentDb: JudgmentDb = { morning_card_judgments: { create } };
  await app.register(
    createMorningCardsRoutes({
      getDb: () => ({}) as MorningCardsDb,
      getJudgmentDb: () => judgmentDb,
    }),
    { prefix: '/api/v1/morning-cards' }
  );
  return app;
}

describe('POST /api/v1/morning-cards/judgments', () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('returns 404 and writes nothing when the flag is unset', async () => {
    const create = jest.fn();
    const app = await build('u1', create);
    const res = await app.inject({ method: 'POST', url: URL, payload: VALID });
    expect(res.statusCode).toBe(404);
    expect(create).not.toHaveBeenCalled();
    await app.close();
  });

  it('returns 403 and writes nothing for a non-test user', async () => {
    process.env['MOBILE_MORNING_CARDS'] = 'true';
    process.env['MORNING_CARDS_TEST_USER_IDS'] = 'u1';
    const create = jest.fn();
    const app = await build('other', create);
    const res = await app.inject({ method: 'POST', url: URL, payload: VALID });
    expect(res.statusCode).toBe(403);
    expect(create).not.toHaveBeenCalled();
    await app.close();
  });

  it('writes exactly one row for a test user', async () => {
    process.env['MOBILE_MORNING_CARDS'] = 'true';
    process.env['MORNING_CARDS_TEST_USER_IDS'] = 'u1';
    const create = jest.fn().mockResolvedValue({});
    const app = await build('u1', create);
    const res = await app.inject({ method: 'POST', url: URL, payload: VALID });
    expect(res.statusCode).toBe(201);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].data).toMatchObject({
      user_id: 'u1',
      video_id: 'abcdefghijk',
      verdict: 'useful',
      shown_position: 2,
    });
    await app.close();
  });

  it('returns 400 and writes nothing for an unknown verdict', async () => {
    process.env['MOBILE_MORNING_CARDS'] = 'true';
    process.env['MORNING_CARDS_TEST_USER_IDS'] = 'u1';
    const create = jest.fn();
    const app = await build('u1', create);
    const res = await app.inject({
      method: 'POST',
      url: URL,
      payload: { ...VALID, verdict: 'maybe' },
    });
    expect(res.statusCode).toBe(400);
    expect(create).not.toHaveBeenCalled();
    await app.close();
  });
});
