import Fastify, { FastifyInstance } from 'fastify';
import { createMorningCardsRoutes } from '@/api/routes/morning-cards';
import type { MorningCardsDb } from '@/modules/morning-cards/source';

export {};

const ENV_KEYS = ['MOBILE_MORNING_CARDS', 'MORNING_CARDS_TEST_USER_IDS'] as const;

function fakeDb(): MorningCardsDb {
  const year = new Date().getUTCFullYear();
  return {
    video_pool_domain_tags: {
      findMany: async () => [
        {
          relevance_score: 0.9,
          source: 'rule',
          video_pool: {
            video_id: 'abcdefghijk',
            title: 'T',
            channel_name: 'C',
            published_at: new Date(Date.UTC(year, 5, 1)),
            thumbnail_url: null,
          },
        },
      ],
    },
  };
}

async function build(userId: string | null): Promise<FastifyInstance> {
  const app = Fastify();
  app.decorate('authenticate', async (request: any, reply: any) => {
    if (!userId) return reply.code(401).send({ status: 'error' });
    request.user = { userId };
  });
  await app.register(createMorningCardsRoutes({ getDb: fakeDb }), {
    prefix: '/api/v1/morning-cards',
  });
  return app;
}

describe('GET /api/v1/morning-cards', () => {
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

  it('returns 404 when the flag is unset', async () => {
    const app = await build('u1');
    const res = await app.inject({ url: '/api/v1/morning-cards?domain=ai_tools' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('returns 403 for a non-test user', async () => {
    process.env['MOBILE_MORNING_CARDS'] = 'true';
    process.env['MORNING_CARDS_TEST_USER_IDS'] = 'u1';
    const app = await build('other');
    const res = await app.inject({ url: '/api/v1/morning-cards?domain=ai_tools' });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('returns 200 with cards for a test user', async () => {
    process.env['MOBILE_MORNING_CARDS'] = 'true';
    process.env['MORNING_CARDS_TEST_USER_IDS'] = 'u1';
    const app = await build('u1');
    const res = await app.inject({ url: '/api/v1/morning-cards?domain=ai_tools' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.cards).toHaveLength(1);
    expect(body.data.cards[0].video_id).toBe('abcdefghijk');
    expect(body.data.shortage).toBe(true);
    await app.close();
  });

  it('returns 400 for an unknown domain', async () => {
    process.env['MOBILE_MORNING_CARDS'] = 'true';
    process.env['MORNING_CARDS_TEST_USER_IDS'] = 'u1';
    const app = await build('u1');
    const res = await app.inject({ url: '/api/v1/morning-cards?domain=nope' });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
