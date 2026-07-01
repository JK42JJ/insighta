/**
 * Observability Phase 2-A — key-count alarm evaluation unit tests.
 * Pure count/threshold logic; no I/O, no email, no key values.
 */
import { evaluateKeyAlarm } from '@/modules/queue/handlers/key-alarm';

describe('evaluateKeyAlarm', () => {
  it('single SEARCH key → no alarm (healthy steady state)', () => {
    const r = evaluateKeyAlarm({ YOUTUBE_API_KEY_SEARCH: 'k1' }, 1);
    expect(r.searchKeys).toBe(1);
    expect(r.shouldAlarm).toBe(false);
  });

  it('multiple SEARCH keys → alarm (ToS ban risk)', () => {
    const env: Record<string, string> = { YOUTUBE_API_KEY_SEARCH: 'k1' };
    for (let i = 2; i <= 8; i++) env[`YOUTUBE_API_KEY_SEARCH_${i}`] = `k${i}`;
    const r = evaluateKeyAlarm(env, 1);
    expect(r.searchKeys).toBe(8);
    expect(r.shouldAlarm).toBe(true);
  });

  it('legacy single YOUTUBE_API_KEY fallback → counts as 1, no alarm', () => {
    const r = evaluateKeyAlarm({ YOUTUBE_API_KEY: 'legacy' }, 1);
    expect(r.searchKeys).toBe(1);
    expect(r.shouldAlarm).toBe(false);
  });

  it('threshold is honored (maxKeys=3 → 3 keys ok, 4 alarms)', () => {
    const mk = (n: number) => {
      const env: Record<string, string> = { YOUTUBE_API_KEY_SEARCH: 'k1' };
      for (let i = 2; i <= n; i++) env[`YOUTUBE_API_KEY_SEARCH_${i}`] = `k${i}`;
      return env;
    };
    expect(evaluateKeyAlarm(mk(3), 3).shouldAlarm).toBe(false);
    expect(evaluateKeyAlarm(mk(4), 3).shouldAlarm).toBe(true);
  });

  it('counts VIDEOS keys separately (falls back to SEARCH pool when unset)', () => {
    const r = evaluateKeyAlarm(
      {
        YOUTUBE_API_KEY_SEARCH: 'k1',
        YOUTUBE_API_KEY_VIDEOS: 'v1',
        YOUTUBE_API_KEY_VIDEOS_2: 'v2',
      },
      1
    );
    expect(r.videosKeys).toBe(2);
  });

  it('no keys at all → 0, no alarm', () => {
    const r = evaluateKeyAlarm({}, 1);
    expect(r.searchKeys).toBe(0);
    expect(r.shouldAlarm).toBe(false);
  });
});
