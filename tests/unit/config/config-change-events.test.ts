import {
  buildFlagsFingerprint,
  diffFlags,
  isConfigChangeEventsEnabled,
} from '@/config/config-change-events';

describe('config-change-events (perf-monitor PR1)', () => {
  it('flag defaults off (no-op)', () => {
    expect(isConfigChangeEventsEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(
      isConfigChangeEventsEnabled({ CONFIG_CHANGE_EVENTS_ENABLED: 'true' } as NodeJS.ProcessEnv)
    ).toBe(true);
  });

  it('fingerprint captures whitelisted prefixes only', () => {
    const env = {
      V3_SEMANTIC_MIN_COSINE: '0.45',
      V5_TARGET_PICKS: '60',
      DISCOVER_SUBGOAL_ANCHOR_ENABLED: 'true',
      JUDGE_DEBOOST_ENABLED: 'true',
      NODE_ENV: 'production',
      REDIS_HOST: 'redis',
      PATH: '/usr/bin',
    } as unknown as NodeJS.ProcessEnv;
    const fp = buildFlagsFingerprint(env);
    expect(fp).toEqual({
      V3_SEMANTIC_MIN_COSINE: '0.45',
      V5_TARGET_PICKS: '60',
      DISCOVER_SUBGOAL_ANCHOR_ENABLED: 'true',
      JUDGE_DEBOOST_ENABLED: 'true',
    });
  });

  it('never captures secret-looking keys even under a whitelisted prefix', () => {
    const env = {
      V3_API_KEY: 'sk-xxx',
      DISCOVER_WEBHOOK_TOKEN: 'tok',
      WIZARD_DB_PASSWORD: 'pw',
      V5_CALLBACK_URL: 'https://x',
      V5_TARGET_PICKS: '60',
    } as unknown as NodeJS.ProcessEnv;
    const fp = buildFlagsFingerprint(env);
    expect(Object.keys(fp)).toEqual(['V5_TARGET_PICKS']);
  });

  it('diffFlags reports adds, removes, and changes only', () => {
    const d = diffFlags({ A: '1', B: '2', C: '3' }, { A: '1', B: '9', D: '4' });
    expect(d).toEqual({
      B: { from: '2', to: '9' },
      C: { from: '3', to: null },
      D: { from: null, to: '4' },
    });
  });
});
