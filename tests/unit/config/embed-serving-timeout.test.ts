/**
 * Serving-path embed fast-timeout gate (P0 2026-07-10). Pure config unit —
 * unset flag is a no-op ({} opts → embedBatch keeps the 20s x 2 default),
 * enabled carries the measurement-grounded defaults (12s / 0 retry), and both
 * are env-tunable. See src/config/embed-serving-timeout.ts.
 */
import {
  isEmbedServingFastTimeoutEnabled,
  getEmbedServingTimeoutMs,
  getEmbedServingMaxRetries,
  servingEmbedOptions,
} from '@/config/embed-serving-timeout';

describe('embed-serving-timeout gate', () => {
  test('unset → disabled, servingEmbedOptions is a no-op {} (flag alone rolls back)', () => {
    expect(isEmbedServingFastTimeoutEnabled({})).toBe(false);
    expect(servingEmbedOptions({})).toEqual({});
  });

  test.each(['true', '1', 'yes', 'TRUE', 'Yes'])('enabled by %s', (v) => {
    expect(isEmbedServingFastTimeoutEnabled({ EMBED_SERVING_FAST_TIMEOUT_ENABLED: v })).toBe(true);
  });

  test.each(['false', '0', 'no', ''])('stays disabled for %s', (v) => {
    expect(isEmbedServingFastTimeoutEnabled({ EMBED_SERVING_FAST_TIMEOUT_ENABLED: v })).toBe(false);
  });

  test('enabled → opts carry the grounded defaults (12000ms, 0 retries, servingScope)', () => {
    expect(servingEmbedOptions({ EMBED_SERVING_FAST_TIMEOUT_ENABLED: 'true' })).toEqual({
      timeoutMs: 12_000,
      maxRetries: 0,
      servingScope: true,
    });
  });

  test('env overrides timeout + retries when enabled', () => {
    const o = servingEmbedOptions({
      EMBED_SERVING_FAST_TIMEOUT_ENABLED: '1',
      EMBED_SERVING_TIMEOUT_MS: '8000',
      EMBED_SERVING_MAX_RETRIES: '1',
    });
    expect(o.timeoutMs).toBe(8000);
    expect(o.maxRetries).toBe(1);
    expect(o.servingScope).toBe(true);
  });

  test('invalid / non-positive env values fall back to defaults', () => {
    expect(getEmbedServingTimeoutMs({ EMBED_SERVING_TIMEOUT_MS: 'abc' })).toBe(12_000);
    expect(getEmbedServingTimeoutMs({ EMBED_SERVING_TIMEOUT_MS: '-5' })).toBe(12_000);
    expect(getEmbedServingTimeoutMs({ EMBED_SERVING_TIMEOUT_MS: '0' })).toBe(12_000);
    expect(getEmbedServingMaxRetries({ EMBED_SERVING_MAX_RETRIES: 'x' })).toBe(0);
    expect(getEmbedServingMaxRetries({ EMBED_SERVING_MAX_RETRIES: '-1' })).toBe(0);
  });

  test('maxRetries override accepts an explicit 0 vs a positive value', () => {
    expect(getEmbedServingMaxRetries({ EMBED_SERVING_MAX_RETRIES: '0' })).toBe(0);
    expect(getEmbedServingMaxRetries({ EMBED_SERVING_MAX_RETRIES: '2' })).toBe(2);
  });
});
