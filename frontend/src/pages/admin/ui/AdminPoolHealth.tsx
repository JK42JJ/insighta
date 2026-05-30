/**
 * Admin Content Pool Health dashboard.
 *
 * Renders five sections (Volume / Enrich / Source / Reuse / Promote) from
 * `GET /api/v1/admin/pool-health`. Each metric carries a precomputed
 * status badge (`ok` / `warn` / `critical`) so the user sees the health
 * judgment at a glance — no raw number scanning required.
 *
 * Thresholds live in `src/config/pool-health.ts` and are exported plain
 * constants so the policy is editable in one place.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import {
  apiClient,
  type AdminPoolHealthResponse,
  type PoolHealthMetric,
} from '@/shared/lib/api-client';
import { cn } from '@/shared/lib/utils';
import { PoolHealthBadge } from './PoolHealthBadge';
import { PoolHealthDetailDialog } from './PoolHealthDetailDialog';

// Metrics whose click opens a drill-down dialog (BE endpoint exists).
const DRILLDOWN_KEYS: ReadonlySet<string> = new Set([
  'richSummaryV1Pct',
  'richSummaryV1LlmPct',
  'richSummaryV2Pct',
  'captionFailRate7d',
  'lastBulkFireHours',
  'nullSourcePct',
]);

function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

// All metric values render through one funnel — 2-decimal floats, locale
// integers, suffix on percent/hours/days. Prevents the 14-digit raw
// float rendering (CP807-style polish) and keeps thresholds consistent.
function formatMetricValue(m: PoolHealthMetric): string {
  if (m.unit === '%') return `${m.value.toFixed(2)}%`;
  if (m.unit === 'ratio') return m.value.toFixed(2);
  if (m.unit === 'hours') return `${m.value.toFixed(2)}h ago`;
  if (m.unit === 'days') {
    const rounded = Math.round(m.value);
    return `${rounded} day${rounded === 1 ? '' : 's'}`;
  }
  return formatNumber(m.value);
}

function thresholdText(m: PoolHealthMetric): string {
  const arrow = m.threshold.direction === 'higher_is_better' ? '≥' : '≤';
  const fmt = (v: number): string => {
    if (m.unit === '%') return `${v}%`;
    if (m.unit === 'hours') return `${v}h`;
    if (m.unit === 'ratio') return v.toFixed(2);
    if (m.unit === 'days') return `${v}d`;
    return String(v);
  };
  return `${arrow} ${fmt(m.threshold.ok)} ok · ${arrow} ${fmt(m.threshold.warn)} warn`;
}

function MetricCard({
  metric,
  onClick,
}: {
  metric: PoolHealthMetric;
  onClick?: (metric: PoolHealthMetric) => void;
}) {
  const isNa = metric.status === 'na';
  const clickable = !isNa && DRILLDOWN_KEYS.has(metric.key);
  return (
    <button
      type="button"
      onClick={clickable && onClick ? () => onClick(metric) : undefined}
      disabled={!clickable}
      aria-label={clickable ? `Open detail for ${metric.label}` : metric.label}
      className={cn(
        'text-left rounded-lg border border-border bg-card p-4 transition-colors',
        clickable ? 'hover:border-primary/40 hover:bg-card/80 cursor-pointer' : 'cursor-default'
      )}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs text-muted-foreground">{metric.label}</span>
        <PoolHealthBadge status={metric.status} />
      </div>
      <div
        className={cn(
          'text-2xl font-semibold tabular-nums',
          isNa ? 'text-muted-foreground' : 'text-foreground'
        )}
      >
        {formatMetricValue(metric)}
        {isNa && <span className="ml-2 text-xs font-normal">(측정 대기)</span>}
      </div>
      <div className="flex items-center justify-between text-[10px] text-muted-foreground mt-1">
        <span>{isNa ? 'Disabled until launch (see Known Issues)' : thresholdText(metric)}</span>
        {clickable && <span className="text-primary/70 ml-2 shrink-0">details ›</span>}
      </div>
    </button>
  );
}

function Sparkline({
  rows,
  height = 36,
}: {
  rows: Array<{ day: string; n: number }>;
  height?: number;
}) {
  if (rows.length === 0) {
    return <div className="text-xs text-muted-foreground">no data</div>;
  }
  const sorted = [...rows].sort((a, b) => (a.day < b.day ? -1 : 1));
  const max = Math.max(1, ...sorted.map((r) => r.n));
  const w = Math.max(120, sorted.length * 8);
  const points = sorted
    .map((r, i) => {
      const x = (i / Math.max(1, sorted.length - 1)) * w;
      const y = height - (r.n / max) * (height - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg width={w} height={height} className="text-primary">
      <polyline fill="none" stroke="currentColor" strokeWidth="1.5" points={points} />
    </svg>
  );
}

function VolumeSection({ data }: { data: AdminPoolHealthResponse }) {
  const { totals, daily30d, derived } = data.volume;
  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <h2 className="text-sm font-semibold text-foreground mb-3">1. Volume Trend</h2>
      <div className="grid grid-cols-3 gap-3 mb-4 text-sm">
        <div>
          <div className="text-xs text-muted-foreground">video_pool</div>
          <div className="text-lg font-semibold text-foreground tabular-nums">
            {formatNumber(totals.video_pool)}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">youtube_videos</div>
          <div className="text-lg font-semibold text-foreground tabular-nums">
            {formatNumber(totals.youtube_videos)}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">recommendation_cache</div>
          <div className="text-lg font-semibold text-foreground tabular-nums">
            {formatNumber(totals.recommendation_cache)}
          </div>
        </div>
      </div>
      <div className="space-y-3">
        <div>
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span>video_pool daily inflow (30d)</span>
            <span>
              avg{' '}
              <span className="font-medium text-foreground">{derived.videoPoolAvgDaily30d}</span> ·
              blank{' '}
              <span className="font-medium text-foreground">{derived.videoPoolBlankDays30d}</span>d
            </span>
          </div>
          <Sparkline rows={daily30d.video_pool} />
        </div>
        <div>
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span>youtube_videos daily inflow (30d)</span>
          </div>
          <Sparkline rows={daily30d.youtube_videos} />
        </div>
        <div>
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span>recommendation_cache daily creation (30d)</span>
          </div>
          <Sparkline rows={daily30d.recommendation_cache} />
        </div>
      </div>
    </section>
  );
}

function GaugeBar({ pct, status }: { pct: number; status: PoolHealthMetric['status'] }) {
  const color =
    status === 'ok'
      ? 'bg-emerald-500'
      : status === 'warn'
        ? 'bg-amber-500'
        : status === 'critical'
          ? 'bg-red-500'
          : 'bg-zinc-500';
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className="h-2 bg-muted/40 rounded overflow-hidden">
      <div className={cn('h-full', color)} style={{ width: `${clamped}%` }} />
    </div>
  );
}

function EnrichSection({ data }: { data: AdminPoolHealthResponse }) {
  const v1 = data.enrich.richSummaryV1;
  const v2 = data.enrich.richSummaryV2;
  const em = data.enrich.embedding;
  const v1Status = data.metrics.find((m) => m.key === 'richSummaryV1Pct')?.status ?? 'critical';
  const v1LlmStatus =
    data.metrics.find((m) => m.key === 'richSummaryV1LlmPct')?.status ?? 'critical';
  const v2Status = data.metrics.find((m) => m.key === 'richSummaryV2Pct')?.status ?? 'critical';
  const emStatus = data.metrics.find((m) => m.key === 'embeddingPct')?.status ?? 'critical';
  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <h2 className="text-sm font-semibold text-foreground mb-3">
        2. Enrich Coverage — V1 (legacy) / V2 (real) / embedding
      </h2>
      <div className="grid grid-cols-2 gap-4 text-sm mb-4">
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-muted-foreground">V1 video_summaries (legacy)</span>
            <PoolHealthBadge status={v1Status} />
          </div>
          <div className="text-lg font-semibold text-foreground tabular-nums mb-2">{v1.pct}%</div>
          <GaugeBar pct={v1.pct} status={v1Status} />
          <div className="text-[10px] text-muted-foreground mt-1">
            {formatNumber(v1.covered)} / {formatNumber(v1.total)} — missing{' '}
            {formatNumber(v1.missing)}
          </div>
          <div className="mt-2 flex items-center justify-between text-[10px]">
            <span className="text-muted-foreground">↳ LLM-authored</span>
            <span className="flex items-center gap-2">
              <span className="text-foreground tabular-nums">
                {v1.llmPct}% ({formatNumber(v1.llmCovered)})
              </span>
              <PoolHealthBadge status={v1LlmStatus} />
            </span>
          </div>
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-muted-foreground">↳ metadata fallback (no LLM)</span>
            <span className="text-foreground tabular-nums">
              {v1.fallbackPct}% ({formatNumber(v1.fallbackCovered)})
            </span>
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-muted-foreground">V2 video_rich_summaries (pass)</span>
            <PoolHealthBadge status={v2Status} />
          </div>
          <div className="text-lg font-semibold text-foreground tabular-nums mb-2">{v2.pct}%</div>
          <GaugeBar pct={v2.pct} status={v2Status} />
          <div className="text-[10px] text-muted-foreground mt-1">
            {formatNumber(v2.covered)} / {formatNumber(v2.total)} — missing{' '}
            {formatNumber(v2.missing)}
          </div>
          {v2.modelBreakdown.length > 0 && (
            <div className="mt-2 space-y-0.5">
              {v2.modelBreakdown.slice(0, 4).map((m) => (
                <div key={m.model} className="flex items-center justify-between text-[10px]">
                  <span className="text-muted-foreground truncate max-w-[200px]">{m.model}</span>
                  <span className="text-foreground tabular-nums">{formatNumber(m.n)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-muted-foreground">embedding (video_pool)</span>
          <PoolHealthBadge status={emStatus} />
        </div>
        <div className="text-lg font-semibold text-foreground tabular-nums mb-2">{em.pct}%</div>
        <GaugeBar pct={em.pct} status={emStatus} />
        <div className="text-[10px] text-muted-foreground mt-1">
          {formatNumber(em.covered)} / {formatNumber(em.total)} — missing {formatNumber(em.missing)}
        </div>
      </div>
    </section>
  );
}

function CaptionPipelineSection({ data }: { data: AdminPoolHealthResponse }) {
  const c = data.captionPipeline;
  const failStatus = data.metrics.find((m) => m.key === 'captionFailRate7d')?.status ?? 'critical';
  const fireStatus = data.metrics.find((m) => m.key === 'lastBulkFireHours')?.status ?? 'critical';
  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <h2 className="text-sm font-semibold text-foreground mb-3">
        2b. Caption Pipeline — Mac Mini CC bulk
      </h2>
      <div className="grid grid-cols-4 gap-3 text-sm">
        <div>
          <div className="text-xs text-muted-foreground">Attempts (7d)</div>
          <div className="text-lg font-semibold text-foreground tabular-nums">
            {formatNumber(c.attempted7d)}
          </div>
          <div className="text-[10px] text-muted-foreground">
            lifetime {formatNumber(c.attemptedTotal)}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Pass / Fail (7d)</div>
          <div className="text-lg font-semibold text-foreground tabular-nums">
            {formatNumber(c.pass7d)} / {formatNumber(c.fail7d)}
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Fail rate (7d)</span>
            <PoolHealthBadge status={failStatus} />
          </div>
          <div className="text-lg font-semibold text-foreground tabular-nums">{c.failRate7d}%</div>
          <div className="text-[10px] text-muted-foreground">awk + webshare mixed</div>
        </div>
        <div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Last fire</span>
            <PoolHealthBadge status={fireStatus} />
          </div>
          <div className="text-lg font-semibold text-foreground tabular-nums">
            {c.hoursSinceLastFire.toFixed(1)}h ago
          </div>
          <div className="text-[10px] text-muted-foreground">
            {c.lastAttemptedAt ? new Date(c.lastAttemptedAt).toLocaleString() : 'never'}
          </div>
        </div>
      </div>
    </section>
  );
}

function SourceRow({ rows, total }: { rows: Array<{ source: string; n: number }>; total: number }) {
  return (
    <div className="space-y-1">
      {rows.map((r) => {
        const pct = total > 0 ? Math.round((1000 * r.n) / total) / 10 : 0;
        return (
          <div key={r.source} className="flex items-center gap-2 text-xs">
            <span className="w-44 truncate text-muted-foreground">{r.source}</span>
            <div className="flex-1 h-1.5 bg-muted/40 rounded overflow-hidden">
              <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
            </div>
            <span className="w-16 text-right tabular-nums text-foreground">{pct}%</span>
            <span className="w-14 text-right tabular-nums text-muted-foreground">
              {formatNumber(r.n)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function SourceSection({ data }: { data: AdminPoolHealthResponse }) {
  const yvTotal = data.source.youtube_videos.reduce((a, r) => a + r.n, 0);
  const vpTotal = data.source.video_pool.reduce((a, r) => a + r.n, 0);
  const userInflowStatus =
    data.metrics.find((m) => m.key === 'userInflowPct')?.status ?? 'critical';
  const nullSourceStatus =
    data.metrics.find((m) => m.key === 'nullSourcePct')?.status ?? 'critical';
  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <h2 className="text-sm font-semibold text-foreground mb-3">3. Source Mix (30d)</h2>
      <div className="grid grid-cols-2 gap-6">
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-muted-foreground">youtube_videos.source</span>
            <PoolHealthBadge status={nullSourceStatus} />
          </div>
          <SourceRow rows={data.source.youtube_videos} total={yvTotal} />
          <div className="text-[10px] text-muted-foreground mt-2">
            NULL/legacy share {data.source.derived.nullSourcePct}%
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-muted-foreground">video_pool.source</span>
            <PoolHealthBadge status={userInflowStatus} />
          </div>
          <SourceRow rows={data.source.video_pool} total={vpTotal} />
          <div className="text-[10px] text-muted-foreground mt-2">
            User inflow share {data.source.derived.userInflowPct}%
          </div>
        </div>
      </div>
    </section>
  );
}

function ReuseSection({ data }: { data: AdminPoolHealthResponse }) {
  const avgStatus = data.metrics.find((m) => m.key === 'avgReusePerVideo')?.status ?? 'critical';
  const mandalaStatus =
    data.metrics.find((m) => m.key === 'reuse2PlusMandalaPct')?.status ?? 'critical';
  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <h2 className="text-sm font-semibold text-foreground mb-3">4. Reuse / Duplication (30d)</h2>
      <div className="grid grid-cols-4 gap-3 mb-4 text-sm">
        <div>
          <div className="text-xs text-muted-foreground">Total recs</div>
          <div className="text-lg font-semibold text-foreground tabular-nums">
            {formatNumber(data.reuse.totalRecs30d)}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Unique videos</div>
          <div className="text-lg font-semibold text-foreground tabular-nums">
            {formatNumber(data.reuse.uniqueVideos30d)}
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-xs text-muted-foreground">Avg reuse</span>
            <PoolHealthBadge status={avgStatus} />
          </div>
          <div className="text-lg font-semibold text-foreground tabular-nums">
            {data.reuse.avgReusePerVideo.toFixed(2)}
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-xs text-muted-foreground">2+ mandalas</span>
            <PoolHealthBadge status={mandalaStatus} />
          </div>
          <div className="text-lg font-semibold text-foreground tabular-nums">
            {data.reuse.videosIn2PlusMandalas} ({data.reuse.reuse2PlusMandalaPct}%)
          </div>
        </div>
      </div>
      <div>
        <div className="text-xs text-muted-foreground mb-2">Top 15 reuse offenders</div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr className="border-b border-border">
                <th className="text-left py-1.5 pr-2 font-medium">video_id</th>
                <th className="text-right py-1.5 pr-2 font-medium">mandalas</th>
                <th className="text-right py-1.5 pr-2 font-medium">users</th>
                <th className="text-right py-1.5 font-medium">recs</th>
              </tr>
            </thead>
            <tbody>
              {data.reuse.top15.map((r) => (
                <tr key={r.video_id} className="border-b border-border/60">
                  <td className="py-1 pr-2 font-mono text-foreground">{r.video_id}</td>
                  <td className="py-1 pr-2 text-right tabular-nums text-foreground">
                    {r.mandalas}
                  </td>
                  <td className="py-1 pr-2 text-right tabular-nums text-foreground">{r.users}</td>
                  <td className="py-1 text-right tabular-nums text-foreground">{r.recs}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function PromoteSection({ data }: { data: AdminPoolHealthResponse }) {
  const status = data.metrics.find((m) => m.key === 'promotePct')?.status ?? 'critical';
  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <h2 className="text-sm font-semibold text-foreground mb-3">5. Promote Funnel (30d)</h2>
      <div className="grid grid-cols-4 gap-3 mb-4 text-sm">
        <div>
          <div className="text-xs text-muted-foreground">Distinct recs</div>
          <div className="text-lg font-semibold text-foreground tabular-nums">
            {formatNumber(data.promote.totalDistinctRecs)}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">auto_added rows</div>
          <div className="text-lg font-semibold text-foreground tabular-nums">
            {formatNumber(data.promote.totalAutoOwned)}
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-xs text-muted-foreground">Promote %</span>
            <PoolHealthBadge status={status} />
          </div>
          <div className="text-lg font-semibold text-foreground tabular-nums">
            {data.promote.promotePct}%
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Mandalas w/ recs</div>
          <div className="text-lg font-semibold text-foreground tabular-nums">
            {data.promote.mandalasWithRecs}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 text-[10px]">
        {data.promote.statusBreakdown.map((s) => (
          <span
            key={s.status}
            className="px-2 py-1 rounded bg-muted/40 text-muted-foreground tabular-nums"
          >
            {s.status}: {formatNumber(s.n)}
          </span>
        ))}
        <span className="px-2 py-1 rounded bg-muted/40 text-muted-foreground tabular-nums">
          surfaced_at present: {data.promote.surfacedAtPresent} ({data.promote.surfacedAtPct}%)
        </span>
      </div>
    </section>
  );
}

function KnownIssuesBanner({ issues }: { issues: ReadonlyArray<{ id: string; text: string }> }) {
  if (issues.length === 0) return null;
  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
      <div className="flex items-center gap-1.5 text-amber-300 mb-1.5 font-medium">
        <AlertTriangle className="h-3.5 w-3.5" />
        Known issues (별건 — dashboard surfaces only, fix tracked separately)
      </div>
      <ul className="list-disc list-inside space-y-0.5 text-muted-foreground">
        {issues.map((i) => (
          <li key={i.id}>{i.text}</li>
        ))}
      </ul>
    </div>
  );
}

export function AdminPoolHealth() {
  const [refreshTick, setRefreshTick] = useState(0);
  const [activeMetric, setActiveMetric] = useState<PoolHealthMetric | null>(null);
  const { data, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: ['admin', 'pool-health', refreshTick],
    queryFn: () => apiClient.getAdminPoolHealth(refreshTick > 0),
    staleTime: 60_000,
  });

  return (
    <div className="p-6 max-w-6xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Content Pool Health</h1>
          {data && (
            <p className="text-xs text-muted-foreground mt-1">
              Generated {new Date(data.generatedAt).toLocaleString()} ·{' '}
              {data.fromCache ? 'cached' : data.stale ? 'stale snapshot (DB unavailable)' : 'fresh'}
            </p>
          )}
        </div>
        <button
          onClick={() => {
            setRefreshTick((t) => t + 1);
            void refetch();
          }}
          disabled={isFetching}
          className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50"
        >
          <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {isError && (
        <div className="px-3 py-2 rounded-md bg-red-500/10 text-red-400 text-sm">
          Failed to load pool health: {(error as Error)?.message ?? 'unknown error'}
        </div>
      )}

      {isLoading && !data && (
        <div className="px-3 py-2 rounded-md bg-muted/20 text-muted-foreground text-sm">
          Loading…
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-3 gap-3">
            {data.metrics.map((m) => (
              <MetricCard key={m.key} metric={m} onClick={(metric) => setActiveMetric(metric)} />
            ))}
          </div>
          <PoolHealthDetailDialog
            metric={activeMetric}
            open={activeMetric !== null}
            onOpenChange={(o) => !o && setActiveMetric(null)}
          />
          <KnownIssuesBanner issues={data.knownIssues} />
          <VolumeSection data={data} />
          <EnrichSection data={data} />
          <CaptionPipelineSection data={data} />
          <SourceSection data={data} />
          <ReuseSection data={data} />
          <PromoteSection data={data} />
        </>
      )}
    </div>
  );
}
