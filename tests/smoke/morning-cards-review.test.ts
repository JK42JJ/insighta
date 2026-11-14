import Fastify, { FastifyInstance } from 'fastify';
import { createMorningCardsRoutes } from '@/api/routes/morning-cards';
import type { MorningCardsDb } from '@/modules/morning-cards/source';
import type { JudgmentReviewDb } from '@/modules/morning-cards/judgment-repo';

export {};

const ENV_KEYS = ['MOBILE_MORNING_CARDS', 'MORNING_CARDS_TEST_USER_IDS'] as const;
const BASE = '/api/v1/morning-cards';

function poolRow(videoId: string) {
  return {
    relevance_score: 0.9,
    source: 'test',
    video_pool: {
      video_id: videoId,
      title: 'Title',
      channel_name: 'Chan',
      published_at: new Date(Date.UTC(new Date().getUTCFullYear(), 5, 1)),
      thumbnail_url: null,
    },
  };
}

async function build(
  userId: string,
  reviewDb: JudgmentReviewDb,
  rows = [poolRow('abcdefghijk'), poolRow('bbbbbbbbbbb')]
): Promise<FastifyInstance> {
  const app = Fastify();
  app.decorate('authenticate', async (request: any) => {
    request.user = { userId };
  });
  const db = { video_pool_domain_tags: { findMany: jest.fn().mockResolvedValue(rows) } };
  await app.register(
    createMorningCardsRoutes({
      getDb: () => db as unknown as MorningCardsDb,
      getReviewDb: () => reviewDb,
    }),
    { prefix: BASE }
  );
  return app;
}

describe('morning cards review list', () => {
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

  function reviewDb(findRows: any[] = [], count = 1) {
    return {
      morning_card_judgments: {
        findMany: jest.fn().mockResolvedValue(findRows),
        updateMany: jest.fn().mockResolvedValue({ count }),
      },
    } as unknown as JudgmentReviewDb & {
      morning_card_judgments: { findMany: jest.Mock; updateMany: jest.Mock };
    };
  }

  it('returns 404 when the flag is unset', async () => {
    const app = await build('u1', reviewDb());
    const res = await app.inject({ method: 'GET', url: `${BASE}/review?domain=ai_tools` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('returns 403 for a non-test user', async () => {
    process.env['MOBILE_MORNING_CARDS'] = 'true';
    process.env['MORNING_CARDS_TEST_USER_IDS'] = 'u1';
    const app = await build('other', reviewDb());
    const res = await app.inject({ method: 'GET', url: `${BASE}/review?domain=ai_tools` });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('merges the latest saved verdict and tags into the cards', async () => {
    process.env['MOBILE_MORNING_CARDS'] = 'true';
    process.env['MORNING_CARDS_TEST_USER_IDS'] = 'u1';
    const db = reviewDb([
      { video_id: 'abcdefghijk', verdict: 'skip', reason_tags: ['generic'] },
      { video_id: 'abcdefghijk', verdict: 'useful', reason_tags: [] },
    ]);
    const app = await build('u1', db);
    const res = await app.inject({ method: 'GET', url: `${BASE}/review?domain=ai_tools` });
    expect(res.statusCode).toBe(200);
    const items = res.json().data.items;
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ verdict: 'skip', reason_tags: ['generic'], position: 0 });
    expect(items[1]).toMatchObject({ verdict: null, reason_tags: [], position: 1 });
    await app.close();
  });

  it('PATCH sets valid reason tags for the calling user only', async () => {
    process.env['MOBILE_MORNING_CARDS'] = 'true';
    process.env['MORNING_CARDS_TEST_USER_IDS'] = 'u1';
    const db = reviewDb();
    const app = await build('u1', db);
    const res = await app.inject({
      method: 'PATCH',
      url: `${BASE}/judgments/reason-tags`,
      payload: {
        video_id: 'abcdefghijk',
        domain: 'ai_tools',
        reason_tags: ['outdated', 'outdated'],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(db.morning_card_judgments.updateMany).toHaveBeenCalledWith({
      where: { user_id: 'u1', video_id: 'abcdefghijk', domain: 'ai_tools' },
      data: { reason_tags: ['outdated'] },
    });
    await app.close();
  });

  it('PATCH rejects an unknown tag and returns 404 when no judgment exists', async () => {
    process.env['MOBILE_MORNING_CARDS'] = 'true';
    process.env['MORNING_CARDS_TEST_USER_IDS'] = 'u1';
    const bad = reviewDb();
    let app = await build('u1', bad);
    let res = await app.inject({
      method: 'PATCH',
      url: `${BASE}/judgments/reason-tags`,
      payload: { video_id: 'abcdefghijk', domain: 'ai_tools', reason_tags: ['nope'] },
    });
    expect(res.statusCode).toBe(400);
    expect(bad.morning_card_judgments.updateMany).not.toHaveBeenCalled();
    await app.close();

    app = await build('u1', reviewDb([], 0));
    res = await app.inject({
      method: 'PATCH',
      url: `${BASE}/judgments/reason-tags`,
      payload: { video_id: 'abcdefghijk', domain: 'ai_tools', reason_tags: ['generic'] },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
