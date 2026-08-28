/**
 * Brief serving, admin registration, unsubscribe.
 *
 * The guarantee worth a test here is the one the static path got wrong: an
 * unknown slug used to answer 200 with the app shell, so a bad link looked
 * fine until someone read it. Every negative case below is that failure in a
 * different disguise.
 *
 * Split deliberately: the pure checks always run, the inject checks run only
 * where a server can boot. A suite that silently skips its real assertions in
 * CI is worse than one that admits it needs an environment.
 */

process.env['ENCRYPTION_SECRET'] ??=
  'test-secret-test-secret-test-secret-test-secret-test-secret-1234';

import { issueNumber, IssueDocumentSchema } from '@/modules/newsletter/issue-schema';

export {};

describe('issueNumber', () => {
  const doc = (issueLabel: string) =>
    ({ issueLabel }) as unknown as Parameters<typeof issueNumber>[0];

  it('reads the digits out of a label', () => {
    expect(issueNumber(doc('제9호'))).toBe(9);
    expect(issueNumber(doc('제10호'))).toBe(10);
  });

  it('treats 창간호 as issue 1', () => {
    expect(issueNumber(doc('창간호'))).toBe(1);
  });

  /**
   * The reason this is an integer column rather than the label: sorted as
   * text, 제10호 lands before 제9호, and the archive lists in the wrong order.
   */
  it('orders numerically, which the label does not', () => {
    const labels = ['제9호', '제10호', '제1호'];
    expect(labels.map((l) => issueNumber(doc(l))).sort((a, b) => a - b)).toEqual([1, 9, 10]);
    expect([...labels].sort()).toEqual(['제10호', '제1호', '제9호']);
  });
});

describe('IssueDocumentSchema, as the admin route applies it', () => {
  it('refuses a document that is not one', () => {
    expect(IssueDocumentSchema.safeParse({ title: 'hello' }).success).toBe(false);
    expect(IssueDocumentSchema.safeParse(null).success).toBe(false);
  });
});

const canBootServer = !!(
  process.env['SUPABASE_JWT_SECRET'] ||
  process.env['JWT_SECRET'] ||
  process.env['SUPABASE_URL']
);
const describeIfServer = canBootServer ? describe : describe.skip;

describeIfServer('brief routes', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any;

  // buildServer registers every route and cron; it takes well over Jest's
  // 5s default on a cold module graph.
  const BOOT_MS = 60_000;

  beforeAll(async () => {
    const { buildServer } = await import('../../src/api/server');
    app = await buildServer();
    await app.ready();
  }, BOOT_MS);

  afterAll(async () => {
    await app?.close();
  }, BOOT_MS);

  it('rejects a malformed slug before touching the database', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/brief/BAD_SLUG!!' });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a malformed unsubscribe token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/u/short' });
    expect(res.statusCode).toBe(400);
  });

  /**
   * Hard rule for new admin routes: unauthenticated must be 401, verified by
   * request rather than by reading the onRequest array.
   */
  it.each([
    ['GET', '/api/v1/admin/newsletter/issues'],
    ['POST', '/api/v1/admin/newsletter/issues'],
    ['PUT', '/api/v1/admin/newsletter/issues/00000000-0000-0000-0000-000000000000'],
    ['DELETE', '/api/v1/admin/newsletter/issues/00000000-0000-0000-0000-000000000000'],
  ])('%s %s is 401 without a token', async (method, url) => {
    const res = await app.inject({ method, url });
    expect(res.statusCode).toBe(401);
  });

  const describeIfDb = process.env['DATABASE_URL'] ? describe : describe.skip;

  describeIfDb('with a database', () => {
    it('answers 404 for an unknown slug rather than the app shell', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/brief/no-such-issue-here' });
      expect(res.statusCode).toBe(404);
      expect(res.headers['content-type']).toContain('text/plain');
      expect(res.body).not.toContain('<!DOCTYPE html>');
    });

    it('answers 404 for an unknown unsubscribe token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/u/aaaaaaaaaaaaaaaaaaaa',
      });
      expect(res.statusCode).toBe(404);
    });
  });
});
