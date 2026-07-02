/**
 * P0 trust gate config (scam-inflow 2026-07-03) — a 5-view impersonation
 * channel reached the add-cards candidate list because the live path had no
 * view floor. This pins the flag contract: unset = today's behavior (off).
 */

import {
  getV5Config,
  resetV5ConfigForTest,
} from '../../src/skills/plugins/video-discover/v5/config';

describe('V5_LIVE_VIEW_FLOOR — trust gate flag contract', () => {
  beforeEach(() => resetV5ConfigForTest());
  test('unset → 0 (gate off, todays behavior unchanged)', () => {
    const cfg = getV5Config({} as NodeJS.ProcessEnv);
    expect(cfg.liveViewFloor).toBe(0);
  });

  test('set → coerced numeric floor (fail-closed filter engages)', () => {
    const cfg = getV5Config({ V5_LIVE_VIEW_FLOOR: '1000' } as unknown as NodeJS.ProcessEnv);
    expect(cfg.liveViewFloor).toBe(1000);
  });

  test('negative rejected by schema (floor cannot be below zero)', () => {
    expect(() =>
      getV5Config({ V5_LIVE_VIEW_FLOOR: '-5' } as unknown as NodeJS.ProcessEnv)
    ).toThrow();
  });
});
