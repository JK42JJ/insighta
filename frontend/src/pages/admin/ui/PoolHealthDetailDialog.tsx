/**
 * Drill-down dialog for a single Pool Health metric.
 *
 * Opens on MetricCard click. Lazy-fetches detail via
 * `GET /api/v1/admin/pool-health/details/:metric` and renders the rows
 * + optional time series + explanatory notes. Each metric carries its
 * own column layout in `COLUMN_BY_METRIC`.
 */

import { useQuery } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/shared/ui/dialog';
import { apiClient, type PoolHealthMetric } from '@/shared/lib/api-client';
import { PoolHealthBadge } from './PoolHealthBadge';

interface ColumnDef {
  key: string;
  label: string;
  align?: 'left' | 'right';
  mono?: boolean;
  width?: string;
}

const COLUMN_BY_METRIC: Record<string, ColumnDef[]> = {
  richSummaryV1Pct: [
    { key: 'model', label: 'model', mono: true },
    { key: 'n', label: 'rows', align: 'right' },
    { key: 'first_at', label: 'first_at' },
    { key: 'last_at', label: 'last_at' },
  ],
  richSummaryV1LlmPct: [
    { key: 'video_id', label: 'video_id', mono: true, width: '120px' },
    { key: 'title', label: 'title' },
    { key: 'model', label: 'model', mono: true },
    { key: 'created_at', label: 'created_at' },
  ],
  richSummaryV2Pct: [
    { key: 'model', label: 'model', mono: true },
    { key: 'quality_flag', label: 'quality_flag' },
    { key: 'n', label: 'rows', align: 'right' },
    { key: 'last_updated_at', label: 'last_updated_at' },
  ],
  captionFailRate7d: [
    { key: 'youtube_video_id', label: 'video_id', mono: true, width: '120px' },
    { key: 'title', label: 'title' },
    { key: 'channel_title', label: 'channel' },
    { key: 'default_language', label: 'lang' },
    { key: 'duration_seconds', label: 'dur', align: 'right' },
    { key: 'attempted_at', label: 'attempted_at' },
  ],
  lastBulkFireHours: [
    { key: 'youtube_video_id', label: 'video_id', mono: true, width: '120px' },
    { key: 'title', label: 'title' },
    { key: 'channel_title', label: 'channel' },
    { key: 'source', label: 'source' },
    { key: 'attempted_at', label: 'attempted_at' },
  ],
  nullSourcePct: [
    { key: 'youtube_video_id', label: 'video_id', mono: true, width: '120px' },
    { key: 'title', label: 'title' },
    { key: 'channel_title', label: 'channel' },
    { key: 'view_count', label: 'views', align: 'right' },
    { key: 'created_at', label: 'created_at' },
  ],
};

function Sparkline({ series }: { series: Array<{ bucket: string; n: number }> }) {
  if (!series || series.length === 0) {
    return <div className="text-xs text-muted-foreground">no series</div>;
  }
  const sorted = [...series].sort((a, b) => (a.bucket < b.bucket ? -1 : 1));
  const max = Math.max(1, ...sorted.map((r) => r.n));
  const w = Math.max(240, sorted.length * 12);
  const h = 48;
  const points = sorted
    .map((r, i) => {
      const x = (i / Math.max(1, sorted.length - 1)) * w;
      const y = h - (r.n / max) * (h - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <div className="space-y-1">
      <svg width={w} height={h} className="text-primary">
        <polyline fill="none" stroke="currentColor" strokeWidth="1.5" points={points} />
      </svg>
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{sorted[0]?.bucket}</span>
        <span>max {max}</span>
        <span>{sorted[sorted.length - 1]?.bucket}</span>
      </div>
    </div>
  );
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return value.toLocaleString('en-US');
    return value.toFixed(2);
  }
  if (typeof value === 'string') {
    if (value.length > 80) return `${value.slice(0, 77)}…`;
    return value;
  }
  return String(value);
}

export interface PoolHealthDetailDialogProps {
  metric: PoolHealthMetric | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PoolHealthDetailDialog({
  metric,
  open,
  onOpenChange,
}: PoolHealthDetailDialogProps) {
  const enabled = open && metric !== null;
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['admin', 'pool-health', 'detail', metric?.key],
    queryFn: () => apiClient.getAdminPoolHealthDetail(metric!.key),
    enabled,
    staleTime: 60_000,
  });

  if (!metric) return null;

  const columns = COLUMN_BY_METRIC[metric.key] ?? [{ key: 'value', label: 'value' }];
  const arrow = metric.threshold.direction === 'higher_is_better' ? '≥' : '≤';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between gap-3">
            <DialogTitle className="text-base">{metric.label}</DialogTitle>
            <PoolHealthBadge status={metric.status} />
          </div>
          <DialogDescription className="text-xs">
            current value <span className="font-medium text-foreground">{metric.value}</span>
            {metric.unit === '%' ? '%' : metric.unit === 'hours' ? 'h' : ''} · band {arrow}{' '}
            {metric.threshold.ok} {metric.unit === '%' ? '%' : ''} ok · {arrow}{' '}
            {metric.threshold.warn} {metric.unit === '%' ? '%' : ''} warn (
            {metric.threshold.direction})
          </DialogDescription>
        </DialogHeader>

        {isLoading && <div className="text-xs text-muted-foreground py-4">loading detail…</div>}
        {isError && (
          <div className="text-xs text-red-400 py-4">
            failed to load detail: {(error as Error)?.message ?? 'unknown error'}
          </div>
        )}
        {data && (
          <div className="space-y-4">
            {data.notes && (
              <p className="text-xs text-muted-foreground leading-relaxed">{data.notes}</p>
            )}
            {data.series && data.series.length > 0 && (
              <div>
                <div className="text-xs text-muted-foreground mb-1">trend</div>
                <Sparkline series={data.series} />
              </div>
            )}
            <div>
              <div className="text-xs text-muted-foreground mb-1">rows ({data.rows.length})</div>
              {data.rows.length === 0 ? (
                <div className="text-xs text-muted-foreground py-3">no rows</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-muted-foreground">
                      <tr className="border-b border-border">
                        {columns.map((c) => (
                          <th
                            key={c.key}
                            className={
                              c.align === 'right'
                                ? 'text-right py-1.5 pr-3 font-medium'
                                : 'text-left py-1.5 pr-3 font-medium'
                            }
                            style={c.width ? { width: c.width } : undefined}
                          >
                            {c.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.rows.map((row, i) => (
                        <tr key={i} className="border-b border-border/60">
                          {columns.map((c) => (
                            <td
                              key={c.key}
                              className={
                                (c.align === 'right'
                                  ? 'py-1 pr-3 text-right tabular-nums '
                                  : 'py-1 pr-3 ') +
                                (c.mono ? 'font-mono' : '') +
                                ' text-foreground'
                              }
                            >
                              {formatCell(row[c.key])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="text-[10px] text-muted-foreground">
              detail generated {new Date(data.generatedAt).toLocaleString()}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
