import Fastify from 'fastify';
import { createMorningCardsRoutes } from '@/api/routes/morning-cards';
import type { MorningCardsDb } from '@/modules/morning-cards/source';

export {};

const FLAG = 'MOBILE_MORNING_CARDS';

async function status(): Promise<{ code: number; enabled: boolean }> {
  const app = Fastify();
  app.decorate('authenticate', async () => undefined);
  await app.register(
    createMorningCardsRoutes({ getDb: () => ({}) as unknown as MorningCardsDb }),
    { prefix: '/api/v1/morning-cards' }
  );
  const res = await app.inject({ url: '/api/v1/morning-cards/status' });
  await app.close();
  return { code: res.statusCode, enabled: res.json().data.enabled };
}

describe('GET /api/v1/morning-cards/status', () => {
  const saved = process.env[FLAG];
  afterEach(() => {
    if (saved === undefined) delete process.env[FLAG];
    else process.env[FLAG] = saved;
  });

  it('reports enabled=false with 200 when the flag is unset', async () => {
    delete process.env[FLAG];
    expect(await status()).toEqual({ code: 200, enabled: false });
  });

  it('reports enabled=true when the flag is on', async () => {
    process.env[FLAG] = 'true';
    expect(await status()).toEqual({ code: 200, enabled: true });
  });
});
