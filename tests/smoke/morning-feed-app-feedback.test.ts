import fs from 'fs';
import path from 'path';
import Fastify, { FastifyInstance } from 'fastify';
import { createMorningFeedRoutes } from '@/api/routes/morning-feed';
import {
  APP_FEEDBACK_BODY_MAX,
  APP_FEEDBACK_DAILY_MAX,
  deviceOf,
  replayUrlOrNull,
  saveAppFeedback,
  validateAppFeedback,
} from '@/modules/morning-feed/app-feedback';
import { FeedValidationError, type FeedDb } from '@/modules/morning-feed/feed';

/*
 * Comments from the app (decision R30 + work order B4, 2026-11-25): POST /morning-feed/app-feedback
 * stores one append-only row, refuses an empty or too long comment and the 21st in 24 hours, keeps
 * the comment when its context does not fit, and never logs the text.
 */

const ENV_KEYS = [
  'MOBILE_MORNING_CARDS',
  'MORNING_CARDS_TEST_USER_IDS',
  'MORNING_BRIEF_OWNER_ID',
] as const;
const URL_ = '/api/v1/morning-feed/app-feedback';
const USER = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-2222-4222-8222-222222222222';
const REPLAY = 'https://us.posthog.com/project/phc_test/replay/0190-abc?t=42';
const TEXT = 'secret-comment-text';
const ROOT = path.resolve(__dirname, '../..');

function fakeDb(written: number | Error = 1) {
  const calls: unknown[][] = [];
  const db: FeedDb = {
    $queryRawUnsafe: jest.fn(async () => [] as never),
    $executeRawUnsafe: jest.fn(async (...args: unknown[]) => {
      calls.push(args);
      if (written instanceof Error) throw written;
      return written;
    }),
  };
  return { db, calls };
}

async function build(db: FeedDb, lines: string[] = [], user: string | null = USER) {
  const app: FastifyInstance = Fastify({
    logger: { level: 'trace', stream: { write: (l: string) => void lines.push(l) } },
  });
  app.decorate('authenticate', async (request: any, reply: any) => {
    if (!user) return reply.code(401).send({ status: 'error' });
    request.user = { userId: user };
  });
  await app.register(createMorningFeedRoutes({ getDb: () => db }), {
    prefix: '/api/v1/morning-feed',
  });
  return app;
}

describe('validateAppFeedback', () => {
  it('keeps the comment as one trimmed line with its context', () => {
    expect(
      validateAppFeedback({
        kind: 'menu',
        body: '  a\r\nb\u0000c  ',
        screen: 'home',
        path: '/morning-cards?view=watch',
        cell: '기술/개발',
        date: '2026-11-25',
        replay_url: REPLAY,
      })
    ).toEqual({
      kind: 'menu',
      body: 'a b c',
      screen: 'home',
      path: '/morning-cards?view=watch',
      cell: '기술/개발',
      seen_date: '2026-11-25',
      replay_url: REPLAY,
    });
  });

  it('refuses a missing, empty or too long comment and an unknown kind', () => {
    for (const body of [undefined, null, 1, '', '  \n ', 'x'.repeat(APP_FEEDBACK_BODY_MAX + 1)]) {
      expect(() => validateAppFeedback({ kind: 'menu', body })).toThrow(FeedValidationError);
    }
    for (const kind of [undefined, 'other', 'Menu']) {
      expect(() => validateAppFeedback({ kind, body: 'x' })).toThrow(FeedValidationError);
    }
    expect(() => validateAppFeedback(null)).toThrow(FeedValidationError);
    expect(
      validateAppFeedback({ kind: 'menu', body: 'x'.repeat(APP_FEEDBACK_BODY_MAX) }).body
    ).toHaveLength(APP_FEEDBACK_BODY_MAX);
  });

  it('context that does not fit becomes null; the comment is kept', () => {
    expect(
      validateAppFeedback({
        kind: 'menu',
        body: 'x',
        screen: 'Home Screen',
        path: '//evil.example/x',
        cell: 'no such cell',
        date: '2026-02-31',
        replay_url: 'https://evil.example/project/a/replay/b',
      })
    ).toEqual({
      kind: 'menu',
      body: 'x',
      screen: null,
      path: null,
      cell: null,
      seen_date: null,
      replay_url: null,
    });
  });

  it("a 'brief' comment names its brief (cell and date)", () => {
    expect(() => validateAppFeedback({ kind: 'brief', body: 'x' })).toThrow(FeedValidationError);
    expect(() => validateAppFeedback({ kind: 'brief', body: 'x', cell: '기술/개발' })).toThrow(
      FeedValidationError
    );
    expect(
      validateAppFeedback({ kind: 'brief', body: 'x', cell: '기술/개발', date: '2026-11-25' }).kind
    ).toBe('brief');
  });
});

describe('replayUrlOrNull', () => {
  it('only a PostHog replay address', () => {
    expect(replayUrlOrNull(REPLAY)).toBe(REPLAY);
    for (const bad of [
      null,
      '',
      'not a url',
      REPLAY.replace('https', 'http'),
      'https://posthog.com.evil.example/project/a/replay/b',
      'https://user@us.posthog.com/project/a/replay/b',
      'https://us.posthog.com/login',
      REPLAY + 'x'.repeat(500),
    ]) {
      expect(replayUrlOrNull(bad)).toBeNull();
    }
  });
});

describe('deviceOf', () => {
  it('cuts the User-Agent to the column; none = null', () => {
    expect(deviceOf('A'.repeat(300))).toHaveLength(200);
    expect(deviceOf(undefined)).toBeNull();
    expect(deviceOf('  ')).toBeNull();
  });
});

describe('saveAppFeedback', () => {
  const input = validateAppFeedback({
    kind: 'menu',
    body: 'x',
    cell: '기술/개발',
    date: '2026-11-25',
  });

  it('one INSERT that counts the account’s last 24 hours itself', async () => {
    const { db, calls } = fakeDb();
    expect(await saveAppFeedback(db, USER, OWNER, input, 'UA')).toBe(true);
    expect(calls).toHaveLength(1);
    const [sql, ...params] = calls[0]!;
    expect(String(sql)).toMatch(/INSERT INTO public\.morning_app_feedback/);
    expect(String(sql)).toMatch(/interval '24 hours'/);
    expect(params).toEqual([
      USER,
      'menu',
      'x',
      null,
      null,
      OWNER,
      '기술/개발',
      '2026-11-25',
      'UA',
      null,
      APP_FEEDBACK_DAILY_MAX,
    ]);
  });

  it('no brief on screen = no brief owner; nothing written = false', async () => {
    const { db, calls } = fakeDb(0);
    const noDate = { ...input, seen_date: null };
    expect(await saveAppFeedback(db, USER, OWNER, noDate, null)).toBe(false);
    expect(calls[0]![6]).toBeNull();
  });
});

describe('POST /app-feedback', () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    process.env['MOBILE_MORNING_CARDS'] = 'true';
    process.env['MORNING_CARDS_TEST_USER_IDS'] = ''; // a participant, not a test account
    process.env['MORNING_BRIEF_OWNER_ID'] = OWNER;
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });
  const post = (app: FastifyInstance, payload: unknown) =>
    app.inject({
      method: 'POST',
      url: URL_,
      payload: payload as object,
      headers: { 'user-agent': 'TestUA' },
    });

  it('a participant’s comment is stored: 201, user id from the token, owner from the server', async () => {
    const { db, calls } = fakeDb();
    const app = await build(db);
    const res = await post(app, {
      kind: 'menu',
      body: TEXT,
      screen: 'page',
      cell: '기술/개발',
      date: '2026-11-25',
      user_id: OWNER, // ignored
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ status: 'ok' });
    expect(calls[0]!.slice(1, 4)).toEqual([USER, 'menu', TEXT]);
    expect(calls[0]![6]).toBe(OWNER);
    expect(calls[0]![9]).toBe('TestUA');
    await app.close();
  });

  it('flag off 404, signed out 401, invalid 400, over the day’s limit 429, too large 413', async () => {
    const { db, calls } = fakeDb(0);
    const app = await build(db);
    expect((await post(app, { kind: 'menu', body: 'x' })).statusCode).toBe(429);
    expect((await post(app, { kind: 'menu', body: ' ' })).statusCode).toBe(400);
    expect((await post(app, { kind: 'menu', body: 'x'.repeat(20_000) })).statusCode).toBe(413);
    expect(calls).toHaveLength(1);
    process.env['MOBILE_MORNING_CARDS'] = 'false';
    expect((await post(app, { kind: 'menu', body: 'x' })).statusCode).toBe(404);
    await app.close();
    process.env['MOBILE_MORNING_CARDS'] = 'true';
    const out = await build(db, [], null);
    expect((await post(out, { kind: 'menu', body: 'x' })).statusCode).toBe(401);
    await out.close();
  });

  it('the text is in no log line and no answer, saved or failed', async () => {
    const lines: string[] = [];
    const ok = await build(fakeDb().db, lines);
    await post(ok, { kind: 'menu', body: TEXT });
    await ok.close();
    const bad = await build(fakeDb(new Error('row (' + TEXT + ') failed')).db, lines);
    const res = await post(bad, { kind: 'menu', body: TEXT });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain(TEXT);
    await bad.close();
    expect(lines.length).toBeGreaterThan(0); // the log was captured
    expect(lines.join('\n')).toContain('app feedback not saved');
    expect(lines.join('\n')).not.toContain(TEXT);
  });
});

describe('schema', () => {
  const SQL = 'prisma/migrations/morning-feed/009_app_feedback.sql';
  const ddl = fs.readFileSync(path.join(ROOT, SQL), 'utf-8');
  const prisma = fs.readFileSync(path.join(ROOT, 'prisma/schema.prisma'), 'utf-8');

  it('the raw SQL is in the runner’s list, idempotent, with row level security', () => {
    const runner = fs.readFileSync(path.join(ROOT, 'scripts/apply-custom-sql.sh'), 'utf-8');
    expect(runner).toContain(`"${SQL}"`);
    expect(ddl).toContain('CREATE TABLE IF NOT EXISTS public.morning_app_feedback');
    expect(ddl).toContain('CREATE INDEX IF NOT EXISTS');
    expect(ddl).toContain('ENABLE ROW LEVEL SECURITY');
    const statements = ddl.replace(/--.*$/gm, '');
    expect(statements).not.toMatch(/\b(DROP|DELETE|UPDATE|TRUNCATE)\b/i);
  });

  it('the Prisma model has the same columns as the raw SQL', () => {
    const table = /CREATE TABLE IF NOT EXISTS[^(]*\(([\s\S]*?)\n\);/.exec(ddl)![1]!;
    const sqlCols = table
      .split('\n')
      .map((l) => /^\s+([a-z_]+)\s/.exec(l)?.[1])
      .filter(Boolean);
    const model = /model morning_app_feedback \{([\s\S]*?)\n\}/.exec(prisma)![1]!;
    const cols = model
      .split('\n')
      .map((l) => /^\s+([a-z_]+)\s/.exec(l)?.[1])
      .filter(Boolean);
    expect(cols).toEqual(sqlCols);
    expect(cols).toHaveLength(13);
  });
});
