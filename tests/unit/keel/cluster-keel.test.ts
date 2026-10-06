/**
 * The split of 2026-10-02: the "is it working now" checks run in the cluster
 * every fifteen minutes, the rest once a day from GitHub, and the daily run is
 * how the cluster's findings reach a person while no Slack webhook exists.
 */

import {
  CLUSTER_KEEL_CHECK,
  CLUSTER_STALE_MINUTES,
  GITHUB_CHECKS,
  interpretClusterKeel,
} from '../../../scripts/keel/checks';
import { CLUSTER_CHECKS } from '../../../src/modules/keel/cluster-checks';
import {
  CLUSTER_RUN_STAGE,
  RUN_STAGE,
  countWorsenedUndelivered,
  shouldFail,
} from '../../../src/modules/keel/ledger';
import { MS_PER_MINUTE } from '../../../src/utils/time-constants';

const NOW = Date.parse('2026-10-02T00:20:00Z');
const minutesAgo = (m: number) => new Date(NOW - m * MS_PER_MINUTE);
const run = (m: number, worsened: string[] = [], confirmedThrows: string[] = []) => ({
  at: minutesAgo(m),
  worsened,
  confirmedThrows,
});

describe('interpretClusterKeel', () => {
  it('is green before the CronJob has ever run, and says why', () => {
    const r = interpretClusterKeel(null, [], [], NOW);
    expect(r.ok).toBe(true);
    expect(r.detail).toMatch(/not run yet/);
  });

  it('is green when the cluster ran recently and nothing worsened', () => {
    const r = interpretClusterKeel(minutesAgo(10), [run(10), run(25), run(40)], [], NOW);
    expect(r.ok).toBe(true);
  });

  it('is red when the cluster stopped reporting -- the case it cannot report itself', () => {
    const r = interpretClusterKeel(minutesAgo(CLUSTER_STALE_MINUTES + 1), [], [], NOW);
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/stopped/);
  });

  it('is green for a worsening the cluster already delivered, and lists it once', () => {
    // 10-04 and 10-05: these turned the daily run red and mailed what Slack had
    // already received.
    const r = interpretClusterKeel(
      minutesAgo(5),
      [run(5), run(200, ['transcript-proxies']), run(215, ['transcript-proxies'])],
      [],
      NOW
    );
    expect(r.ok).toBe(true);
    expect(r.detail).toMatch(/alerted in 24h: transcript-proxies$/);
  });

  it('is red when an alert in the last day reached nobody', () => {
    const r = interpretClusterKeel(
      minutesAgo(5),
      [run(5, ['pipeline-freshness'])],
      [{ at: minutesAgo(5), message: 'pipeline-freshness: delivery failed: HTTP 403' }],
      NOW
    );
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(
      /reached nobody — latest: pipeline-freshness: delivery failed: HTTP 403/
    );
  });
});

describe('red means nobody could be told', () => {
  it('counts only worsenings whose alert was not delivered', () => {
    const outcomes = [
      { alerted: true, ok: false, undelivered: false }, // delivered to Slack
      { alerted: true, ok: false, undelivered: true }, // Slack refused
      { alerted: true, ok: true, undelivered: false }, // a recovery
      { alerted: false, ok: false, undelivered: false }, // steady failure
    ];
    expect(countWorsenedUndelivered(outcomes)).toBe(1);
  });
});

describe('the daily run escalates for the cluster', () => {
  it('is red when cluster-keel fails, on the first daily observation', () => {
    expect(shouldFail({ worsened: 0, threw: 0, escalated: 1 })).toBe(true);
  });

  it('is green otherwise', () => {
    expect(shouldFail({ worsened: 0, threw: 0, escalated: 0 })).toBe(false);
    expect(shouldFail({ worsened: 0, threw: 0 })).toBe(false);
  });
});

describe('the split', () => {
  it('runs each check in exactly one place', () => {
    const cluster = new Set(CLUSTER_CHECKS.map((c) => c.name));
    const github = GITHUB_CHECKS.map((c) => c.name);
    expect(github.filter((n) => cluster.has(n))).toEqual([]);
    expect(cluster.size + github.length).toBe(13);
  });

  it('keeps the two run series apart, and apart from the check names', () => {
    expect(CLUSTER_RUN_STAGE).not.toBe(RUN_STAGE);
    expect([RUN_STAGE, CLUSTER_RUN_STAGE]).not.toContain(CLUSTER_KEEL_CHECK);
  });
});
