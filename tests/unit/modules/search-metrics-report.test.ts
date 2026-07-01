/**
 * Phase 2-B (iii) — daily report HTML builder unit tests.
 * Pure rendering: null=미측정 labels (guard 1), delta arrows, regression banner,
 * key-count shown as a metric only (guard 2). No I/O.
 */
import { buildDailyReportHtml } from '@/modules/queue/handlers/search-metrics-report';
import type { DailyMetrics } from '@/modules/queue/handlers/search-metrics-rollup';

function metrics(over: Partial<DailyMetrics> = {}): DailyMetrics {
  return {
    requests: 100,
    cards_p10: 12,
    cards_p50: 55,
    cards_p90: 90,
    pct_ge_50: 70,
    pct_honest_partial: 20,
    gc_median: null,
    pct_le_6mo: 40,
    freshness: null,
    top_channel_share: 30,
    channel_hhi: 0.2,
    pct_view_lt_1000: 5,
    off_lang_drops: 3,
    pool_active: 14000,
    pool_embedded: 5700,
    pool_ttl_expired_pct: 67,
    quota_units_total: 2500,
    active_search_keys: 8,
    funnel: { PLACED: 500, not_picked: 200, off_lang: 30 },
    algorithm_version: 'cell_binning',
    flags_snapshot: { search_trace_enabled: true },
    ...over,
  };
}

describe('buildDailyReportHtml', () => {
  it('guard 1: gc null → "미측정 (Phase 3 …)", NOT a bad 0', () => {
    const { html } = buildDailyReportHtml('2026-07-01', metrics(), null);
    expect(html).toContain('미측정 (Phase 3 골든코호트)');
    expect(html).not.toMatch(/gc[^<]*0%/);
  });

  it('guard 1: zero trace data → banner + "미측정 (trace 데이터 없음…)"', () => {
    const empty = metrics({
      requests: 0,
      cards_p50: null,
      pct_ge_50: null,
      pct_le_6mo: null,
      off_lang_drops: null,
      funnel: null,
    });
    const { html, subject } = buildDailyReportHtml('2026-07-01', empty, null);
    expect(html).toContain('trace 0건');
    expect(html).toContain('미측정 (trace 데이터 없음');
    expect(subject).toContain('미측정');
  });

  it('delta vs prior renders arrows; a ≥15% wrong-way move is flagged as regression', () => {
    const today = metrics({ cards_p50: 40 }); // down from 55 (-27%) = regression (dir up)
    const prior = metrics({ cards_p50: 55 });
    const { html, regressions, subject } = buildDailyReportHtml('2026-07-01', today, prior);
    expect(regressions.some((r) => r.includes('카드수 P50'))).toBe(true);
    expect(subject).toContain('회귀');
    expect(html).toContain('▼');
  });

  it('no regression when metrics hold → "회귀 없음"', () => {
    const { html, regressions } = buildDailyReportHtml('2026-07-01', metrics(), metrics());
    expect(regressions).toHaveLength(0);
    expect(html).toContain('회귀 없음');
  });

  it('guard 2: active_search_keys shown as a metric, alarm delegated to 2-A', () => {
    const { html } = buildDailyReportHtml('2026-07-01', metrics(), null);
    expect(html).toContain('활성 SEARCH 키');
    expect(html).toContain('알람=2-A');
    expect(html).toContain('8키 알람은 별도(2-A)');
  });

  it('worst-trace highlight renders the deep-link target', () => {
    const { html } = buildDailyReportHtml('2026-07-01', metrics(), null, {
      worstTrace: { traceId: 'tr-123', mandalaId: 'm-9', cards: 2 },
    });
    expect(html).toContain('tr-123');
    expect(html).toContain('2 카드');
  });
});
