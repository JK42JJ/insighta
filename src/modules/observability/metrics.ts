/**
 * Prometheus metrics, written by hand.
 *
 * No prom-client. The exposition format is one line per sample and the whole
 * encoder is the forty lines below; a dependency here would be a megabyte in
 * the API image, a supply-chain surface and a version to keep current, to
 * produce text this file already produces. If histograms with exemplars or a
 * default Node.js collector are ever wanted, that is the moment to take the
 * dependency -- not before.
 *
 * What is deliberately absent: per-endpoint labels drawn from the raw URL.
 * Paths carry ids, and a label whose values are unbounded turns one metric into
 * a series per id. The route pattern Fastify matched is used instead, which is
 * bounded by the number of routes.
 */

/** Buckets in seconds. Chosen against this service's own timeout ladder -- the
 *  ingress cuts at 270s and Fastify at 240 -- so the top bucket is above what
 *  any request is allowed to reach and p99 cannot silently sit in +Inf. */
const LATENCY_BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300];

type Labels = Record<string, string>;

interface CounterState {
  help: string;
  values: Map<string, { labels: Labels; value: number }>;
}

interface HistogramState {
  help: string;
  values: Map<string, { labels: Labels; counts: number[]; sum: number; count: number }>;
}

const counters = new Map<string, CounterState>();
const histograms = new Map<string, HistogramState>();
const gauges = new Map<string, { help: string; read: () => number }>();

/** Stable key for a label set, so the same labels in a different order are the
 *  same series rather than two. */
function key(labels: Labels): string {
  return Object.keys(labels)
    .sort()
    .map((k) => `${k}=${labels[k]}`)
    .join(',');
}

export function incCounter(name: string, help: string, labels: Labels = {}, by = 1): void {
  let c = counters.get(name);
  if (!c) {
    c = { help, values: new Map() };
    counters.set(name, c);
  }
  const k = key(labels);
  const cur = c.values.get(k);
  if (cur) cur.value += by;
  else c.values.set(k, { labels, value: by });
}

export function observeHistogram(
  name: string,
  help: string,
  seconds: number,
  labels: Labels = {}
): void {
  let h = histograms.get(name);
  if (!h) {
    h = { help, values: new Map() };
    histograms.set(name, h);
  }
  const k = key(labels);
  let cur = h.values.get(k);
  if (!cur) {
    cur = { labels, counts: new Array(LATENCY_BUCKETS.length).fill(0), sum: 0, count: 0 };
    h.values.set(k, cur);
  }
  cur.sum += seconds;
  cur.count += 1;
  for (let i = 0; i < LATENCY_BUCKETS.length; i++) {
    if (seconds <= LATENCY_BUCKETS[i]!) cur.counts[i]! += 1;
  }
}

/** A value read at scrape time rather than accumulated. Used for things the
 *  process already knows -- uptime, heap -- where storing a copy would only be
 *  a copy that can go stale. */
export function registerGauge(name: string, help: string, read: () => number): void {
  gauges.set(name, { help, read });
}

function labelString(labels: Labels): string {
  const entries = Object.entries(labels);
  if (entries.length === 0) return '';
  return `{${entries.map(([k, v]) => `${k}="${escape(v)}"`).join(',')}}`;
}

/** The exposition format has three escapes and no more. */
function escape(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

export function renderMetrics(): string {
  const out: string[] = [];

  for (const [name, g] of gauges) {
    out.push(`# HELP ${name} ${g.help}`, `# TYPE ${name} gauge`);
    let v: number;
    try {
      v = g.read();
    } catch {
      // A gauge that throws must not take the whole endpoint with it: a
      // scrape that returns nothing is indistinguishable from a dead process.
      continue;
    }
    out.push(`${name} ${v}`);
  }

  for (const [name, c] of counters) {
    out.push(`# HELP ${name} ${c.help}`, `# TYPE ${name} counter`);
    for (const { labels, value } of c.values.values()) {
      out.push(`${name}${labelString(labels)} ${value}`);
    }
  }

  for (const [name, h] of histograms) {
    out.push(`# HELP ${name} ${h.help}`, `# TYPE ${name} histogram`);
    for (const { labels, counts, sum, count } of h.values.values()) {
      for (let i = 0; i < LATENCY_BUCKETS.length; i++) {
        out.push(
          `${name}_bucket${labelString({ ...labels, le: String(LATENCY_BUCKETS[i]) })} ${counts[i]}`
        );
      }
      out.push(`${name}_bucket${labelString({ ...labels, le: '+Inf' })} ${count}`);
      out.push(`${name}_sum${labelString(labels)} ${sum}`);
      out.push(`${name}_count${labelString(labels)} ${count}`);
    }
  }

  return out.join('\n') + '\n';
}

/** Test seam. Series accumulate for the life of the process, which is correct
 *  for counters and wrong for a test suite. */
export function resetMetricsForTest(): void {
  counters.clear();
  histograms.clear();
  gauges.clear();
}

export { LATENCY_BUCKETS };
