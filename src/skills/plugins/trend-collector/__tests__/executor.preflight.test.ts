/**
 * trend-collector — preflight tests
 *
 * Verifies the read-only validation stage:
 *   - missing YOUTUBE_API_KEY → ok=false with descriptive reason
 *   - present env → ok=true with hydrated state containing all defaults
 *   - hydrated state respects manifest defaults
 *
 * No DB or network is touched here (preflight contract = side-effect-free).
 */

import { executor } from '../executor';
import {
  TREND_COLLECTOR_DEFAULT_CATEGORY_IDS,
  TREND_COLLECTOR_DEFAULT_REGION_CODE,
  TREND_COLLECTOR_MAX_RESULTS_PER_CATEGORY,
} from '../manifest';
import type { PreflightContext } from '@/skills/_shared/types';

const baseCtx: PreflightContext = {
  userId: '00000000-0000-0000-0000-000000000000',
  tier: 'admin',
  env: { YOUTUBE_API_KEY: 'fake-key-for-test' },
};

describe('trend-collector preflight', () => {
  it('fails when YOUTUBE_API_KEY is missing', async () => {
    const result = await executor.preflight({
      ...baseCtx,
      env: {}, // no key
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/YOUTUBE_API_KEY/);
  });

  it('fails when YOUTUBE_API_KEY is the empty string', async () => {
    const result = await executor.preflight({
      ...baseCtx,
      env: { YOUTUBE_API_KEY: '' },
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/YOUTUBE_API_KEY/);
  });

  it('succeeds when YOUTUBE_API_KEY is present', async () => {
    const result = await executor.preflight(baseCtx);
    expect(result.ok).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('hydrates default category IDs, region, and maxResults', async () => {
    const result = await executor.preflight(baseCtx);
    expect(result.ok).toBe(true);
    expect(result.hydrated).toBeDefined();

    const state = result.hydrated as Record<string, unknown>;
    expect(state['apiKey']).toBe('fake-key-for-test');
    expect(state['categoryIds']).toEqual(TREND_COLLECTOR_DEFAULT_CATEGORY_IDS);
    expect(state['regionCode']).toBe(TREND_COLLECTOR_DEFAULT_REGION_CODE);
    expect(state['maxResults']).toBe(TREND_COLLECTOR_MAX_RESULTS_PER_CATEGORY);
  });

  it('does NOT touch process.env (reads only from ctx.env)', async () => {
    // Even if process.env has a different value, preflight must use ctx.env
    const ctxKey = 'ctx-injected-key';
    const result = await executor.preflight({
      ...baseCtx,
      env: { YOUTUBE_API_KEY: ctxKey },
    });
    const state = result.hydrated as Record<string, unknown>;
    expect(state['apiKey']).toBe(ctxKey);
  });

  it('is side-effect free — repeated calls return identical results', async () => {
    const a = await executor.preflight(baseCtx);
    const b = await executor.preflight(baseCtx);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect((a.hydrated as Record<string, unknown>)['apiKey']).toBe(
      (b.hydrated as Record<string, unknown>)['apiKey']
    );
  });
});
