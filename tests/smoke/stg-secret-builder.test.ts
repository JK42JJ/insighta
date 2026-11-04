/**
 * build-stg-secret.py: staging copies prod's env Secret and differs in exactly
 * three kinds of places -- things that message people or charge cards (omitted),
 * unattended scheduled work (flags forced off), and the public address. Each
 * rule has a reason in the script; each is pinned here so a change that copies a
 * payment key, leaves a scheduler on, or keeps a prod address fails. Runs the
 * real script on fixtures; no cluster.
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
  MANDALA_GEN_URL: 'http://self-hosted.invalid:11434',
  LEMONSQUEEZY_API_KEY: 'ls-prod',
  LEMONSQUEEZY_WEBHOOK_SECRET: 'whsec-prod',
  SLACK_ALERT_WEBHOOK: 'https://hooks.invalid/prod-alerts',
  INSIGHTA_BOT_USER_ID: 'prod-user-id',
  YOUTUBE_CLIENT_ID: 'oauth-id',
  YOUTUBE_API_KEY_SEARCH_1: 'yt-1',
  YOUTUBE_API_KEY_SEARCH_8: 'yt-8',
  YOUTUBE_API_KEY_VIDEOS: 'yt-videos',
  YOUTUBE_REDIRECT_URI: 'https://insighta.one/oauth/callback',
  CORS_ORIGIN: 'https://insighta.one',
  TRANSACTIONAL_EMAIL_ENABLED: 'true',
  CURATION_SCHED_KST_ENABLED: 'true',
  V5_QUERY_GEN: 'llm',
  LIVE_SEARCH_GC_GATE: 'shadow',
  V2_AUTO_ENRICH_ENABLED: 'true',
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
  OPENROUTER_API_KEY: 'openrouter-stg',
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

  it('copies the other paid API keys and the self-hosted service addresses as prod has them', () => {
    expect(out['GEMINI_API_KEY']).toBe(PROD['GEMINI_API_KEY']);
    expect(out['MANDALA_GEN_URL']).toBe(PROD['MANDALA_GEN_URL']);
  });

  it('copies every YouTube key, not one', () => {
    for (const k of [
      'YOUTUBE_API_KEY_SEARCH_1',
      'YOUTUBE_API_KEY_SEARCH_8',
      'YOUTUBE_API_KEY_VIDEOS',
      'YOUTUBE_CLIENT_ID',
    ]) {
      expect(out[k]).toBe(PROD[k]);
    }
  });

  it('keeps the prod value of flags that are not fixed, including the LLM-backed query generator', () => {
    expect(out['V5_QUERY_GEN']).toBe('llm');
    expect(out['LIVE_SEARCH_GC_GATE']).toBe('shadow');
    expect(out['SOME_TUNING_FLAG']).toBe('keep-me');
  });

  it('never copies a payment key, an alert destination, or an id that names a prod row', () => {
    for (const k of [
      'LEMONSQUEEZY_API_KEY',
      'LEMONSQUEEZY_WEBHOOK_SECRET',
      'SLACK_ALERT_WEBHOOK',
      'INSIGHTA_BOT_USER_ID',
    ]) {
      expect(out).not.toHaveProperty(k);
    }
  });

  it('fixes e-mail and the unattended scheduled work to false', () => {
    expect(out['TRANSACTIONAL_EMAIL_ENABLED']).toBe('false');
    expect(out['CURATION_SCHED_KST_ENABLED']).toBe('false');
  });

  it('sets the detailed-summary model for staging apart from the one prod uses', () => {
    expect(out['RICH_SUMMARY_V2_MODEL']).toBe('anthropic/claude-haiku-4.5');
  });

  it('stops the creation-time summary chain, so summaries are made only when a card is opened', () => {
    expect(PROD['V2_AUTO_ENRICH_ENABLED']).toBe('true');
    expect(out['V2_AUTO_ENRICH_ENABLED']).toBe('false');
  });

  it('points every public address at staging, including one prod does not set', () => {
    expect(out['PUBLIC_ORIGIN']).toBe('https://stg.insighta.one');
    expect(out['CORS_ORIGIN']).toBe('https://stg.insighta.one');
    expect(out['YOUTUBE_REDIRECT_URI']).toBe('https://stg.insighta.one/oauth/callback');
  });

  it('points the database and Supabase settings at the staging project', () => {
    expect(out['DATABASE_URL']).toBe(OVERRIDES['DATABASE_URL']);
    expect(out['SUPABASE_URL']).toBe(OVERRIDES['SUPABASE_URL']);
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

  it('uses its own OpenRouter key and not the one prod has', () => {
    expect(out['OPENROUTER_API_KEY']).toBe(OVERRIDES['OPENROUTER_API_KEY']);
    expect(out['OPENROUTER_API_KEY']).not.toBe(PROD['OPENROUTER_API_KEY']);
  });

  it('refuses when the staging OpenRouter key is the same as the prod one', () => {
    const r = build({}, { ...OVERRIDES, OPENROUTER_API_KEY: PROD['OPENROUTER_API_KEY'] as string });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/same as prod/);
  });

  it('refuses when a staging database setting is missing', () => {
    const { DIRECT_URL: _omitted, ...partial } = OVERRIDES;
    const r = build({}, partial);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/missing overrides: DIRECT_URL/);
  });
});
