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
    const cfg = loadPoolServeConfig({
      V5_POOL_SERVE_COSINE_RECRUIT: 'true',
    } as unknown as NodeJS.ProcessEnv);
    expect(cfg.relevanceMin).toBe(60);
    expect(cfg.minPerCell).toBe(3);
    expect(cfg.candidatesLimit).toBe(12);
  });
});

describe('loadPoolServeConfig — R23 POOL_SERVE_SOURCES_EXTRA', () => {
  it('defaults to an empty array (current behavior: v2_promoted only)', () => {
    const cfg = loadPoolServeConfig({} as NodeJS.ProcessEnv);
    expect(cfg.sourcesExtra).toEqual([]);
  });

  it('parses a single extra source', () => {
    const cfg = loadPoolServeConfig({
      POOL_SERVE_SOURCES_EXTRA: 'yt_promoted',
    } as unknown as NodeJS.ProcessEnv);
    expect(cfg.sourcesExtra).toEqual(['yt_promoted']);
  });

  it('parses comma-separated extra sources, trimming whitespace and dropping empties', () => {
    const cfg = loadPoolServeConfig({
      POOL_SERVE_SOURCES_EXTRA: ' yt_promoted , , foo_tier ',
    } as unknown as NodeJS.ProcessEnv);
    expect(cfg.sourcesExtra).toEqual(['yt_promoted', 'foo_tier']);
  });

  it('is independent of V5_POOL_SERVE_COSINE_RECRUIT', () => {
    const cfg = loadPoolServeConfig({
      V5_POOL_SERVE_COSINE_RECRUIT: 'true',
    } as unknown as NodeJS.ProcessEnv);
    expect(cfg.sourcesExtra).toEqual([]);
    expect(cfg.cosineRecruit).toBe(true);
  });
});
