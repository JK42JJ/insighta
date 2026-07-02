import { loadPoolServeConfig } from '@/config/pool-serve';

describe('loadPoolServeConfig — cosine recruit flags', () => {
  it('defaults cosine recruit OFF with safe params (no behavior change)', () => {
    const cfg = loadPoolServeConfig({} as NodeJS.ProcessEnv);
    expect(cfg.cosineRecruit).toBe(false);
    expect(cfg.cosineDistMax).toBe(0.45);
    expect(cfg.cosineK).toBe(10);
  });

  it('parses the cosine flags from env when set', () => {
    const cfg = loadPoolServeConfig({
      V5_POOL_SERVE_COSINE_RECRUIT: 'true',
      V5_POOL_SERVE_COSINE_DIST_MAX: '0.4',
      V5_POOL_SERVE_COSINE_K: '8',
    } as unknown as NodeJS.ProcessEnv);
    expect(cfg.cosineRecruit).toBe(true);
    expect(cfg.cosineDistMax).toBe(0.4);
    expect(cfg.cosineK).toBe(8);
  });

  it('keeps the keyword-recruit defaults untouched', () => {
    const cfg = loadPoolServeConfig({ V5_POOL_SERVE_COSINE_RECRUIT: 'true' } as unknown as NodeJS.ProcessEnv);
    expect(cfg.relevanceMin).toBe(60);
    expect(cfg.minPerCell).toBe(3);
    expect(cfg.candidatesLimit).toBe(12);
  });
});
