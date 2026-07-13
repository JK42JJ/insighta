/**
 * Admin performance API smoke (perf-monitor PR2).
 *
 * 1. Route contract: diagnosis GET + events POST return 401 without auth
 *    (admin route hard rule — authenticate + authenticateAdmin).
 * 2. Collapse thresholds: defaults + env overrides.
 *
 * Zero real network calls. Zero LLM API calls.
 */

import { loadCollapseThresholds } from '@/config/collapse-watch';

describe('collapse-watch thresholds', () => {
  it('defaults match the 2026-07-12 measured collapse band', () => {
    const t = loadCollapseThresholds({} as NodeJS.ProcessEnv);
    expect(t).toEqual({
      placeOffP50MaxSec: 15,
      hitRateMin: 0.5,
      cardsP50Min: 20,
      precomputeP95MaxSec: 20,
      shortsMax: 0,
      gatePassRatioMin: 0.2,
      embedP95MaxMs: 8000,
      deboostRateMax: 0.5,
    });
  });

  it('env overrides win', () => {
    const t = loadCollapseThresholds({
      COLLAPSE_CARDS_P50_MIN: '30',
      COLLAPSE_EMBED_P95_MAX_MS: '5000',
    } as NodeJS.ProcessEnv);
    expect(t.cardsP50Min).toBe(30);
    expect(t.embedP95MaxMs).toBe(5000);
  });
});

const canBootServer = !!(
  process.env['SUPABASE_JWT_SECRET'] ||
  process.env['JWT_SECRET'] ||
  process.env['SUPABASE_URL']
);
const describeIfServer = canBootServer ? describe : describe.skip;

describeIfServer('/api/v1/admin/performance — auth rejection', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any;

  beforeAll(async () => {
    const { buildServer } = await import('../../src/api/server');
    app = await buildServer();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('diagnosis returns 401 without a bearer token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/performance/diagnosis' });
    expect(res.statusCode).toBe(401);
  });

  it('manual event POST returns 401 without a bearer token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/performance/events',
      payload: { note: 'x' },
    });
    expect(res.statusCode).toBe(401);
  });
});
