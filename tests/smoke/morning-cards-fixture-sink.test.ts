import Fastify, { FastifyInstance } from 'fastify';
import { createMorningCardsRoutes } from '@/api/routes/morning-cards';

export {};

const BASE = '/api/v1/morning-cards';

async function build(): Promise<{ app: FastifyInstance; touched: jest.Mock }> {
  const touched = jest.fn(() => {
    throw new Error('the fixture sink must not touch the database');
  });
  const app = Fastify();
  // Signed out on purpose: the sink answers without a user.
  app.decorate('authenticate', async () => {
    throw new Error('the fixture sink needs no sign-in');
  });
  await app.register(
    createMorningCardsRoutes({
      getDb: touched as never,
      getJudgmentDb: touched as never,
      getReviewDb: touched as never,
    }),
    { prefix: BASE }
  );
  return { app, touched };
}

describe('morning cards fixture sink', () => {
  it('POST answers 2xx and writes nothing', async () => {
    const { app, touched } = await build();
    const res = await app.inject({
      method: 'POST',
      url: `${BASE}/fixture-sink`,
      payload: { verdict: 'useful', shown_position: 0 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.simulated).toBe(true);
    expect(touched).not.toHaveBeenCalled();
    await app.close();
  });

  it('DELETE answers 2xx and writes nothing', async () => {
    const { app, touched } = await build();
    const res = await app.inject({
      method: 'DELETE',
      url: `${BASE}/fixture-sink`,
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(touched).not.toHaveBeenCalled();
    await app.close();
  });
});
