/**
 * The Prometheus encoder.
 *
 * Written by hand rather than pulled from prom-client, so the format is this
 * project's responsibility and has to be pinned. A malformed line is not a
 * visible bug: the collector drops it and the panel is simply empty.
 */

import {
  incCounter,
  observeHistogram,
  registerGauge,
  renderMetrics,
  resetMetricsForTest,
  LATENCY_BUCKETS,
} from '../../../src/modules/observability/metrics';

beforeEach(() => resetMetricsForTest());

describe('counters', () => {
  it('emits HELP and TYPE before the sample', () => {
    incCounter('x_total', 'a count', { a: '1' });
    const out = renderMetrics();
    expect(out).toContain('# HELP x_total a count');
    expect(out).toContain('# TYPE x_total counter');
    expect(out).toContain('x_total{a="1"} 1');
  });

  it('adds to the same series rather than creating a second', () => {
    incCounter('x_total', 'c', { a: '1' });
    incCounter('x_total', 'c', { a: '1' }, 4);
    expect(renderMetrics()).toContain('x_total{a="1"} 5');
  });

  it('treats the same labels in a different order as one series', () => {
    // Otherwise a route that sets labels in a different order silently doubles
    // its own metric, and the sum is wrong in a way nobody can see.
    incCounter('x_total', 'c', { a: '1', b: '2' });
    incCounter('x_total', 'c', { b: '2', a: '1' });
    const lines = renderMetrics()
      .split('\n')
      .filter((l) => l.startsWith('x_total{'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(' 2');
  });

  it('escapes quotes and backslashes in label values', () => {
    // An unescaped quote ends the label early and the collector rejects the
    // whole line.
    incCounter('x_total', 'c', { route: 'a"b\\c' });
    expect(renderMetrics()).toContain('route="a\\"b\\\\c"');
  });
});

describe('histograms', () => {
  it('is cumulative: each bucket counts everything at or below it', () => {
    observeHistogram('d_seconds', 'd', 0.2, { route: '/x' });
    const out = renderMetrics();
    // 0.2 falls in the 0.25 bucket and every bucket above it.
    expect(out).toContain('le="0.1"} 0');
    expect(out).toContain('le="0.25"} 1');
    expect(out).toContain('le="0.5"} 1');
  });

  it('emits +Inf, sum and count', () => {
    observeHistogram('d_seconds', 'd', 1, {});
    observeHistogram('d_seconds', 'd', 3, {});
    const out = renderMetrics();
    expect(out).toContain('le="+Inf"} 2');
    expect(out).toContain('d_seconds_sum 4');
    expect(out).toContain('d_seconds_count 2');
  });

  it('has a top bucket above the longest a request may run', () => {
    // The ingress cuts at 270s. A top bucket below that leaves p99 sitting in
    // +Inf, where a quantile cannot be computed from it.
    expect(Math.max(...LATENCY_BUCKETS)).toBeGreaterThanOrEqual(270);
  });
});

describe('gauges', () => {
  it('reads at render time, not at registration', () => {
    let n = 1;
    registerGauge('g', 'g', () => n);
    n = 7;
    expect(renderMetrics()).toContain('g 7');
  });

  it('drops a throwing gauge instead of failing the scrape', () => {
    // An empty scrape and a dead process look identical to the collector.
    registerGauge('bad', 'b', () => {
      throw new Error('nope');
    });
    incCounter('good_total', 'g');
    const out = renderMetrics();
    expect(out).toContain('good_total 1');
    expect(out).not.toContain('\nbad ');
  });
});

it('ends with a newline, which the format requires', () => {
  incCounter('x_total', 'c');
  expect(renderMetrics().endsWith('\n')).toBe(true);
});
