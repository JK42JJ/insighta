/**
 * Three timeouts on one path, and the order they have to be in.
 *
 * The path: Keel (a GitHub runner) asks the pod's /health/dependencies, which
 * asks each transcript proxy, which the extractor separately waits on when it
 * actually fetches captions. Each layer has its own budget, and the budgets
 * were not related to each other -- which is how a proxy that worked got
 * reported as down 8 times in 13 runs (measured 2026-09-21).
 *
 * These assertions are the relationship, so a future edit to one number has to
 * consider the others.
 */

import { PROBE_TIMEOUT_MS as KEEL_CLIENT_BUDGET_MS } from '../../../scripts/keel/checks';
import { PROXY_FETCH_TIMEOUT_MS, PROXY_PROBE_TIMEOUT_MS } from '../../../src/config/transcript';

describe('probe budgets', () => {
  it('gives the probe less time than the fetch it predicts', () => {
    // A probe that outlived the fetch would pass a proxy the extractor then
    // times out on: the monitor would report health the product does not have.
    expect(PROXY_PROBE_TIMEOUT_MS).toBeLessThan(PROXY_FETCH_TIMEOUT_MS);
  });

  it('gives the probe more time than the proxy needs to wake up', () => {
    // Measured on prod: six consecutive probes read AbortError, AbortError,
    // 4159ms, 1544ms, 1537ms, 1543ms. The two aborts were the 5 s ceiling this
    // replaced; 4159 ms is the same host, awake. A ceiling at or under the
    // cold start reports a working proxy as down.
    const MEASURED_COLD_START_MS = 4159;
    expect(PROXY_PROBE_TIMEOUT_MS).toBeGreaterThan(MEASURED_COLD_START_MS);
  });

  it("gives Keel's client more time than the endpoint can take", () => {
    // Otherwise the check fails on its own timeout and says nothing about the
    // proxy — a monitoring failure wearing a service failure's clothes.
    expect(KEEL_CLIENT_BUDGET_MS).toBeGreaterThan(PROXY_PROBE_TIMEOUT_MS);
  });
});
