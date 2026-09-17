/**
 * How proxy probe results are judged.
 *
 * The judgement is separated from the fetch so it can be tested without a
 * network, and because the interesting case is not "everything is down" -- it
 * is the partial one, which was silently tolerable before.
 */

import {
  interpretProxyHealth,
  mergeProxyRetry,
  timedOutProxies,
} from '../../../scripts/keel/checks';

const ok = (name: string) => ({ name, ok: true, detail: '42ms' });
const down = (name: string, detail = 'ETIMEDOUT') => ({ name, ok: false, detail });

describe('interpretProxyHealth', () => {
  it('is healthy when every proxy answers', () => {
    const r = interpretProxyHealth([ok('azure'), ok('mac-mini')]);
    expect(r.ok).toBe(true);
    expect(r.detail).toContain('azure ok');
  });

  it('fails when one of two is down, not just when both are', () => {
    // The second proxy exists because the first has failed before. Running on
    // one is running with the spare already spent, which is worth saying while
    // there is still a spare to restore.
    const r = interpretProxyHealth([ok('azure'), down('mac-mini')]);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('1/2');
  });

  it('names the consequence when nothing is reachable', () => {
    // "unreachable" describes the proxy; the message has to describe what stops
    // working, because that is what makes someone act on it.
    const r = interpretProxyHealth([down('azure'), down('mac-mini')]);
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/transcripts, summaries and notes/);
  });

  it('carries the failure reason through, not just the fact', () => {
    const r = interpretProxyHealth([down('mac-mini', 'ECONNREFUSED')]);
    expect(r.detail).toContain('ECONNREFUSED');
  });

  it('treats an empty proxy list as a fault, not as all-clear', () => {
    // A deployment that never finished and an outage both end with no
    // captions; only one of them is fixed by restarting a host.
    const r = interpretProxyHealth([]);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('no transcript proxy is configured');
  });
});

describe('cold-start retry', () => {
  it('retries only proxies that timed out', () => {
    // Waiting fixes a sleeping App Service; it does not fix a refused
    // connection or a rejected token.
    const deps = [
      down('azure', 'AbortError'),
      down('mac-mini', 'ECONNREFUSED'),
      down('other', 'HTTP 401 (token rejected)'),
    ];
    expect(timedOutProxies(deps)).toEqual(['azure']);
    expect(timedOutProxies([ok('azure'), ok('mac-mini')])).toEqual([]);
  });

  it('counts a proxy as reachable when the second probe answers', () => {
    const first = [down('azure', 'AbortError'), ok('mac-mini')];
    const second = [ok('azure'), ok('mac-mini')];
    const merged = mergeProxyRetry(first, second, ['azure']);
    expect(interpretProxyHealth(merged).ok).toBe(true);
  });

  it('still fails when the second probe times out too', () => {
    const first = [down('azure', 'AbortError'), ok('mac-mini')];
    const second = [down('azure', 'AbortError'), ok('mac-mini')];
    const r = interpretProxyHealth(mergeProxyRetry(first, second, ['azure']));
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('1/2');
  });

  it('keeps first-probe results for proxies that were not retried', () => {
    const first = [down('azure', 'AbortError'), down('mac-mini', 'ECONNREFUSED')];
    const second = [ok('azure'), ok('mac-mini')];
    const merged = mergeProxyRetry(first, second, ['azure']);
    expect(merged.find((d) => d.name === 'mac-mini')?.ok).toBe(false);
  });
});
