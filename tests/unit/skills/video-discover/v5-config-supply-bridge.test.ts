/**
 * CP494 ② — v5 poolSources read-side gating by SUPPLY_YT_BRIDGE_ENABLED.
 *
 * The supply bridge writes video_pool rows with source='yt_promoted'; the
 * SAME flag must open the consumption read, or the bridge is a dead write
 * (the ③ reuse-loop lesson). Off = poolSources unchanged (current behavior).
 */

import { getV5Config, resetV5ConfigForTest } from '@/skills/plugins/video-discover/v5/config';

afterEach(() => resetV5ConfigForTest());
beforeEach(() => resetV5ConfigForTest());

describe('v5 poolSources × SUPPLY_YT_BRIDGE_ENABLED', () => {
  test('flag unset → yt_promoted NOT read (current behavior)', () => {
    const cfg = getV5Config({} as NodeJS.ProcessEnv);
    expect(cfg.poolSources).toEqual(['v2_promoted']);
  });

  test('flag off explicitly → yt_promoted NOT read', () => {
    const cfg = getV5Config({ SUPPLY_YT_BRIDGE_ENABLED: 'false' } as NodeJS.ProcessEnv);
    expect(cfg.poolSources).not.toContain('yt_promoted');
  });

  test('flag on → yt_promoted appended to poolSources', () => {
    const cfg = getV5Config({ SUPPLY_YT_BRIDGE_ENABLED: 'true' } as NodeJS.ProcessEnv);
    expect(cfg.poolSources).toEqual(['v2_promoted', 'yt_promoted']);
  });

  test('composes with V5_POOL_SOURCE=all and V5_REUSE_LOOP', () => {
    const cfg = getV5Config({
      V5_POOL_SOURCE: 'all',
      V5_REUSE_LOOP: 'true',
      SUPPLY_YT_BRIDGE_ENABLED: 'true',
    } as NodeJS.ProcessEnv);
    expect(cfg.poolSources).toEqual(['v2_promoted', 'batch_trend', 'user_live', 'yt_promoted']);
  });
});
