/**
 * CP488+ — v2 Quality Audit admin dashboard (Phase 1 MVP).
 *
 * Read-only view. Renders the latest audit run summary card on top
 * (counts + avg score + by-model distribution + by-violation cluster)
 * and the critical-score row list below. A "Run audit now" button
 * triggers the cron path on-demand via the admin route.
 *
 * Design: docs/design/v2-quality-audit-system-2026-05-27.md §9.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/lib/api-client';
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { cn } from '@/shared/lib/utils';

function scoreBadgeClass(score: number): string {
  if (score >= 85) return 'bg-green-500/20 text-green-400';
  if (score >= 70) return 'bg-yellow-500/20 text-yellow-400';
  return 'bg-red-500/20 text-red-400';
}

function formatDuration(seconds: number | null): string {
  if (seconds == null) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function AdminV2QualityAudit() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [scoreMax, setScoreMax] = useState(70);

  const summaryQuery = useQuery({
    queryKey: ['admin', 'v2-quality-audit', 'latest-run'],
    queryFn: () => apiClient.getAdminV2QualityAuditLatestRun(),
    staleTime: 30_000,
  });

  const criticalQuery = useQuery({
    queryKey: ['admin', 'v2-quality-audit', 'critical', page, scoreMax],
    queryFn: () =>
      apiClient.getAdminV2QualityAuditCritical({
        page,
        limit: 30,
        scoreMax,
      }),
    staleTime: 30_000,
  });

  const runMutation = useMutation({
    mutationFn: () => apiClient.triggerAdminV2QualityAuditRun(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'v2-quality-audit'] });
    },
  });

  const run = summaryQuery.data?.data.run ?? null;
  const items = criticalQuery.data?.data.items ?? [];
  const pagination = criticalQuery.data?.data.pagination;

  return (
    <div className="p-6 max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-foreground">v2 Quality Audit</h1>
        <button
          onClick={() => runMutation.mutate()}
          disabled={runMutation.isPending}
          className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50"
        >
          <RefreshCw className={cn('h-4 w-4', runMutation.isPending && 'animate-spin')} />
          {runMutation.isPending ? 'Running…' : 'Run audit now'}
        </button>
      </div>

      {runMutation.error ? (
        <div className="mb-4 px-3 py-2 rounded-md bg-red-500/10 text-red-400 text-sm">
          Failed to trigger audit run.
        </div>
      ) : null}

      {/* Latest run summary card */}
      <div className="bg-card border border-border rounded-lg p-4 mb-6">
        <h2 className="text-sm font-semibold text-muted-foreground mb-3">Latest run</h2>
        {summaryQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !run ? (
          <p className="text-sm text-muted-foreground">
            No audit run has completed yet. Flip{' '}
            <code className="px-1 py-0.5 rounded bg-muted">V2_QUALITY_AUDIT_ENABLED=true</code> or
            click "Run audit now".
          </p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div>
              <div className="text-xs text-muted-foreground mb-1">Run date</div>
              <div className="text-sm font-medium">{run.run_date.slice(0, 10)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Total videos</div>
              <div className="text-sm font-medium">{run.total_videos}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Avg score</div>
              <div className="text-sm font-medium">
                {run.avg_score != null ? Math.round(run.avg_score) : '—'}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Pass / Warning / Critical</div>
              <div className="text-sm font-medium">
                <span className="text-green-400">{run.pass_count}</span>
                {' / '}
                <span className="text-yellow-400">{run.warning_count}</span>
                {' / '}
                <span className="text-red-400">{run.critical_count}</span>
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Status</div>
              <div className="text-sm font-medium">{run.status}</div>
            </div>
          </div>
        )}

        {run?.by_model ? (
          <div className="mt-4 pt-3 border-t border-border">
            <div className="text-xs text-muted-foreground mb-2">By model</div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(run.by_model).map(([model, bucket]) => (
                <span
                  key={model}
                  className="px-2 py-1 rounded-md bg-muted text-xs"
                  title={`${bucket.count} videos, avg ${bucket.avg_score}`}
                >
                  {model}: {bucket.count} (avg {bucket.avg_score})
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {run?.by_violation ? (
          <div className="mt-3">
            <div className="text-xs text-muted-foreground mb-2">By violation</div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(run.by_violation).map(([metric, count]) => (
                <span
                  key={metric}
                  className="px-2 py-1 rounded-md bg-red-500/10 text-red-400 text-xs"
                >
                  {metric}: {count}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {/* Critical row filter */}
      <div className="flex items-center gap-3 mb-4">
        <label className="text-sm text-muted-foreground">Score ≤</label>
        <select
          value={scoreMax}
          onChange={(e) => {
            setScoreMax(Number(e.target.value));
            setPage(1);
          }}
          className="px-3 py-1.5 rounded-md border border-border bg-background text-sm"
        >
          <option value={70}>70 (warning + critical)</option>
          <option value={50}>50</option>
          <option value={30}>30</option>
        </select>
      </div>

      {/* Critical row table */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">
                Score
              </th>
              <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">
                Video
              </th>
              <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">
                Duration
              </th>
              <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">
                Model
              </th>
              <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">
                Top violations
              </th>
            </tr>
          </thead>
          <tbody>
            {criticalQuery.isLoading ? (
              <tr>
                <td colSpan={5} className="text-center py-8 text-muted-foreground text-sm">
                  Loading…
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center py-8 text-muted-foreground text-sm">
                  No critical rows in the latest run.
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <tr
                  key={item.video_id}
                  className="border-b border-border last:border-0 hover:bg-muted/20"
                >
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        'px-2 py-0.5 rounded-full text-xs font-medium',
                        scoreBadgeClass(item.overall_score)
                      )}
                    >
                      {item.overall_score}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <div className="font-medium">{item.title ?? item.video_id}</div>
                    <div className="text-xs text-muted-foreground font-mono">{item.video_id}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                    {formatDuration(item.duration_seconds)}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{item.model ?? '—'}</td>
                  <td className="px-4 py-3 text-xs">
                    {item.violations && item.violations.length > 0 ? (
                      <div className="flex flex-col gap-1">
                        {item.violations.slice(0, 3).map((v) => (
                          <span key={v.metric} className="text-red-400">
                            {v.metric}={v.score} ({v.detail})
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pagination && pagination.totalPages > 1 ? (
        <div className="flex items-center justify-between mt-4">
          <span className="text-sm text-muted-foreground">
            Page {pagination.page} of {pagination.totalPages} ({pagination.total} total)
          </span>
          <div className="flex gap-1">
            <button
              disabled={!pagination.hasPrev}
              onClick={() => setPage((p) => p - 1)}
              className="p-1.5 rounded-md hover:bg-accent disabled:opacity-30"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              disabled={!pagination.hasNext}
              onClick={() => setPage((p) => p + 1)}
              className="p-1.5 rounded-md hover:bg-accent disabled:opacity-30"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
