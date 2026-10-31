/**
 * build-stg-secret.py decides what staging gets from prod's env Secret. Each rule
 * has a cost or safety reason (see the script), so each is pinned here: a change
 * that quietly copies a paid key, a second YouTube key, or a prod project address
 * into staging fails this test. Runs the real script on fixtures; no cluster.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const SCRIPT = path.join(__dirname, '../../scripts/ops/build-stg-secret.py');
const PROD_REF = 'rckkhhjanqgaopynhfgd';

const PROD: Record<string, string> = {
  OPENROUTER_API_KEY: 'fake-openrouter-key-for-test',
  GEMINI_API_KEY: 'gem-prod',
  LEMONSQUEEZY_API_KEY: 'ls-prod',
  LEMONSQUEEZY_WEBHOOK_SECRET: 'whsec-prod',
  YOUTUBE_CLIENT_ID: 'oauth-id',
  YOUTUBE_API_KEY_SEARCH_1: 'yt-1',
  YOUTUBE_API_KEY_SEARCH_8: 'yt-8',
  YOUTUBE_API_KEY_VIDEOS: 'yt-videos',
  TRANSACTIONAL_EMAIL_ENABLED: 'true',
  V5_QUERY_GEN: 'llm',
  LIVE_SEARCH_GC_GATE: 'shadow',
  SOME_TUNING_FLAG: 'keep-me',
  ENCRYPTION_SECRET: 'prod-encryption-secret',
  DATABASE_URL: `postgresql://postgres.${PROD_REF}:pw@host/postgres`,
};
const OVERRIDES: Record<string, string> = {
  DATABASE_URL: 'postgresql://postgres.stgref:pw@host/postgres',
  DIRECT_URL: 'postgresql://postgres.stgref:pw@host:5432/postgres',
  SUPABASE_URL: 'https://stgref.supabase.co',
  SUPABASE_ANON_KEY: 'anon-stg',
  SUPABASE_SERVICE_ROLE_KEY: 'service-stg',
};

function build(stg: Record<string, string>, overrides: Record<string, string> = OVERRIDES) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stg-secret-'));
  const write = (name: string, body: unknown) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, JSON.stringify(body));
    return file;
  };
  const emit = path.join(dir, 'out.json');
  const r = spawnSync(
    'python3',
    [
      SCRIPT,
      '--prod-json',
      write('prod.json', PROD),
      '--stg-json',
      write('stg.json', stg),
      '--emit',
      emit,
    ],
    { input: JSON.stringify(overrides), encoding: 'utf-8' }
  );
  const out =
    r.status === 0 ? (JSON.parse(fs.readFileSync(emit, 'utf-8')) as Record<string, string>) : {};
  return { status: r.status, stderr: r.stderr, out };
}

describe('build-stg-secret.py', () => {
  const { out } = build({});

  it('never copies a pay-per-use API key or a payment secret', () => {
    for (const k of [
      'OPENROUTER_API_KEY',
      'GEMINI_API_KEY',
      'LEMONSQUEEZY_API_KEY',
      'LEMONSQUEEZY_WEBHOOK_SECRET',
    ]) {
      expect(out).not.toHaveProperty(k);
    }
  });

  it('copies exactly one YouTube key, the last search key, and no other YOUTUBE_ value', () => {
    expect(out['YOUTUBE_API_KEY_SEARCH']).toBe('yt-8');
    const youtube = Object.keys(out).filter((k) => k.startsWith('YOUTUBE_'));
    expect(youtube).toEqual(['YOUTUBE_API_KEY_SEARCH']);
  });

  it('fixes the flags that would send mail or spend on a missing API', () => {
    expect(out['TRANSACTIONAL_EMAIL_ENABLED']).toBe('false');
    expect(out['V5_QUERY_GEN']).toBe('rule');
    expect(out['LIVE_SEARCH_GC_GATE']).toBe('off');
  });

  it('copies every other key as prod has it', () => {
    expect(out['SOME_TUNING_FLAG']).toBe('keep-me');
  });

  it('points the database and Supabase settings at the staging project', () => {
    expect(out['DATABASE_URL']).toBe(OVERRIDES['DATABASE_URL']);
    expect(out['SUPABASE_URL']).toBe(OVERRIDES['SUPABASE_URL']);
    expect(out['CORS_ORIGIN']).toBe('https://stg.insighta.one');
    expect(Object.values(out).some((v) => v.includes(PROD_REF))).toBe(false);
  });

  it('generates staging-owned secrets, with an encryption secret of at least 64 characters', () => {
    expect(out['ENCRYPTION_SECRET']).not.toBe(PROD['ENCRYPTION_SECRET']);
    expect((out['ENCRYPTION_SECRET'] ?? '').length).toBeGreaterThanOrEqual(64);
  });

  it('keeps the generated secrets staging already has, so a re-run rotates nothing', () => {
    const again = build({ ENCRYPTION_SECRET: 'x'.repeat(96), REDIS_ADMIN_PASSWORD: 'kept-redis' });
    expect(again.out['ENCRYPTION_SECRET']).toBe('x'.repeat(96));
    expect(again.out['REDIS_ADMIN_PASSWORD']).toBe('kept-redis');
  });

  it('refuses when a value names the prod project', () => {
    const r = build(
      {},
      { ...OVERRIDES, DIRECT_URL: `postgresql://postgres.${PROD_REF}:pw@host:5432/postgres` }
    );
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/refusing: values name the prod project/);
  });

  it('refuses when a staging database setting is missing', () => {
    const { DIRECT_URL: _omitted, ...partial } = OVERRIDES;
    const r = build({}, partial);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/missing overrides: DIRECT_URL/);
  });
});
