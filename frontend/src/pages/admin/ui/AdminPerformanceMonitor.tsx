/**
 * Admin Performance Monitor (perf-monitor PR3, design 2026-07-13).
 *
 * The consolidation page: 검색·품질 계열 admin pages fold into 4 tabs here.
 *   타임라인 — 7d KPI multi-panel (CSS+SVG, recharts 금지 룰) with change-event
 *              markers from config_change_events; marker click → flag diff +
 *              before/after KPI comparison. "KPI drop with NO marker" =
 *              external-cause signal (supervisor rule, shown in header).
 *   파라미터 — live flag fingerprint + change events + manual marker form
 *              (+ Search Algorithms catalog embedded).
 *   공급     — AdminPoolHealth embedded as-is.
 *   품질     — AdminV2QualityAudit embedded as-is.
 *
 * Data: GET /admin/performance/diagnosis (one call, also the fresh-session
 * CC diagnosis endpoint — this page is its human rendering).
 */

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import {
  apiClient,
  type AdminPerformanceDiagnosis,
  type PerfChangeEvent,
  type PerfKpiMandalaDay,
} from '@/shared/lib/api-client';
import { cn } from '@/shared/lib/utils';
import { AdminPoolHealth } from './AdminPoolHealth';
import { AdminV2QualityAudit } from './AdminV2QualityAudit';
import { AdminSearchAlgorithms } from './AdminSearchAlgorithms';

type Tab = 'timeline' | 'params' | 'supply' | 'quality';

const TABS: { key: Tab; label: string }[] = [
  { key: 'timeline', label: '타임라인' },
  { key: 'params', label: '파라미터' },
  { key: 'supply', label: '공급 (Pool)' },
  { key: 'quality', label: '품질 (v2)' },
];

// ── mini SVG line panel ─────────────────────────────────────────────────────

interface SeriesPoint {
  day: string;
  value: number | null;
}

function MiniPanel({
  title,
  points,
  unit,
  threshold,
  markers,
  onMarkerClick,
  selectedDay,
}: {
  title: string;
  points: SeriesPoint[];
  unit: string;
  /** Optional threshold guide line value. */
  threshold?: number;
  /** Days (YYYY-MM-DD) that carry ≥1 change event. */
  markers: Set<string>;
  onMarkerClick: (day: string) => void;
  selectedDay: string | null;
}) {
  const W = 320;
  const H = 96;
  const PAD = { l: 8, r: 8, t: 10, b: 18 };
  const vals = points.map((p) => p.value).filter((v): v is number => v != null);
  const maxRaw = Math.max(...(vals.length ? vals : [1]), threshold ?? 0);
  const max = maxRaw > 0 ? maxRaw * 1.15 : 1;
  const x = (i: number) =>
    PAD.l + (points.length <= 1 ? 0 : (i / (points.length - 1)) * (W - PAD.l - PAD.r));
  const y = (v: number) => H - PAD.b - (v / max) * (H - PAD.t - PAD.b);

  const path = points
    .map((p, i) => (p.value == null ? null : `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`))
    .filter(Boolean)
    .join(' ');

  const last = [...points].reverse().find((p) => p.value != null);

  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-muted-foreground">{title}</span>
        <span className="text-sm font-semibold tabular-nums text-foreground">
          {last?.value != null ? `${Number(last.value.toFixed(2))}${unit}` : '—'}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={title}>
        {threshold != null && threshold <= max && (
          <line
            x1={PAD.l}
            x2={W - PAD.r}
            y1={y(threshold)}
            y2={y(threshold)}
            stroke="currentColor"
            className="text-red-400/50"
            strokeDasharray="4 3"
            strokeWidth="1"
          />
        )}
        {points.map((p, i) =>
          markers.has(p.day) ? (
            <line
              key={`m-${p.day}`}
              x1={x(i)}
              x2={x(i)}
              y1={PAD.t}
              y2={H - PAD.b}
              stroke="currentColor"
              className={cn(
                'cursor-pointer',
                selectedDay === p.day ? 'text-amber-400' : 'text-amber-400/40'
              )}
              strokeWidth={selectedDay === p.day ? 2.5 : 1.5}
              onClick={() => onMarkerClick(p.day)}
            />
          ) : null
        )}
        {path && (
          <polyline
            points={path}
            fill="none"
            stroke="currentColor"
            className="text-primary"
            strokeWidth="1.8"
          />
        )}
        {points.map((p, i) =>
          p.value != null ? (
            <circle key={p.day} cx={x(i)} cy={y(p.value)} r="2.4" className="fill-primary" />
          ) : null
        )}
        {points.map((p, i) => (
          <text
            key={`t-${p.day}`}
            x={x(i)}
            y={H - 5}
            textAnchor="middle"
            className="fill-muted-foreground"
            fontSize="8"
          >
            {p.day.slice(5)}
          </text>
        ))}
      </svg>
    </div>
  );
}

// ── timeline tab ────────────────────────────────────────────────────────────

interface PanelDef {
  key: string;
  title: string;
  unit: string;
  threshold?: number;
  pick: (d: AdminPerformanceDiagnosis) => SeriesPoint[];
}

function mandalaSeries(
  days: PerfKpiMandalaDay[],
  pick: (r: PerfKpiMandalaDay) => number | null
): SeriesPoint[] {
  return days.map((r) => ({ day: r.day, value: pick(r) }));
}

function buildPanels(d: AdminPerformanceDiagnosis): PanelDef[] {
  const t = d.thresholds;
  return [
    {
      key: 'place_off',
      title: '첫카드 배치 p50 (s)',
      unit: 's',
      threshold: t['placeOffP50MaxSec'],
      pick: (x) => mandalaSeries(x.kpi_7d.mandala_days, (r) => r.place_off_p50_s),
    },
    {
      key: 'hit_rate',
      title: '프리컴퓨트 HIT율',
      unit: '',
      pick: (x) =>
        x.kpi_7d.precompute_days.map((r) => ({
          day: r.day,
          value: r.total > 0 ? r.consumed / r.total : null,
        })),
    },
    {
      key: 'cards',
      title: '카드 p50 (장)',
      unit: '',
      threshold: t['cardsP50Min'],
      pick: (x) => mandalaSeries(x.kpi_7d.mandala_days, (r) => r.cards_p50),
    },
    {
      key: 'precompute',
      title: '프리컴퓨트 p95 (s)',
      unit: 's',
      threshold: t['precomputeP95MaxSec'],
      pick: (x) => x.kpi_7d.precompute_days.map((r) => ({ day: r.day, value: r.dur_p95_s })),
    },
    {
      key: 'shorts',
      title: '쇼츠 유입 (건/일)',
      unit: '',
      pick: (x) => mandalaSeries(x.kpi_7d.mandala_days, (r) => r.shorts),
    },
    {
      key: 'deboost',
      title: 'judge 침전율',
      unit: '',
      threshold: t['deboostRateMax'],
      pick: (x) => mandalaSeries(x.kpi_7d.mandala_days, (r) => r.deboost_rate),
    },
    {
      key: 'gate',
      title: '게이트 통과율 (v3)',
      unit: '',
      pick: (x) => x.kpi_7d.trace_days.map((r) => ({ day: r.day, value: r.gate_pass_ratio })),
    },
    {
      key: 'embed',
      title: 'embed p95 (ms)',
      unit: 'ms',
      threshold: t['embedP95MaxMs'],
      pick: (x) => x.kpi_7d.trace_days.map((r) => ({ day: r.day, value: r.embed_p95_ms })),
    },
  ];
}

/** Mean of non-null values strictly before/after the marker day (window edges included). */
function beforeAfter(
  points: SeriesPoint[],
  day: string
): { before: number | null; after: number | null } {
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const before = mean(
    points.filter((p) => p.day < day && p.value != null).map((p) => p.value as number)
  );
  const after = mean(
    points.filter((p) => p.day >= day && p.value != null).map((p) => p.value as number)
  );
  return { before, after };
}

function TimelineTab({ d }: { d: AdminPerformanceDiagnosis }) {
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const panels = useMemo(() => buildPanels(d), [d]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, PerfChangeEvent[]>();
    for (const e of d.events_30d) {
      const day = e.created_at.slice(0, 10);
      if (!map.has(day)) map.set(day, []);
      map.get(day)!.push(e);
    }
    return map;
  }, [d.events_30d]);
  const markerDays = useMemo(() => new Set(eventsByDay.keys()), [eventsByDay]);

  const selectedEvents = selectedDay ? (eventsByDay.get(selectedDay) ?? []) : [];

  return (
    <div className="space-y-4">
      {d.violations.length > 0 ? (
        <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-red-500/10 text-red-400 text-sm">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            <span className="font-semibold">24h 임계 위반 {d.violations.length}건:</span>{' '}
            {d.violations
              .map(
                (v) =>
                  `${v.metric}=${Number(v.value.toFixed(2))} (${v.direction === 'above' ? '>' : '<'} ${v.threshold})`
              )
              .join(' · ')}
          </div>
        </div>
      ) : (
        <div className="px-3 py-2 rounded-md bg-emerald-500/10 text-emerald-400 text-sm">
          24h 임계 위반 없음
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        세로 황색선 = 변경 이벤트(배포·flag·수동 마커), 클릭 시 전/후 대조. 점선 = 임계.{' '}
        <span className="text-amber-400/90">KPI 하락 + 마커 부재 = 외부 원인 신호</span> (임베딩
        제공자·YouTube — provider probe로 분기).
      </p>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {panels.map((p) => (
          <MiniPanel
            key={p.key}
            title={p.title}
            points={p.pick(d)}
            unit={p.unit}
            threshold={p.threshold}
            markers={markerDays}
            onMarkerClick={(day) => setSelectedDay(day === selectedDay ? null : day)}
            selectedDay={selectedDay}
          />
        ))}
      </div>

      {selectedDay && (
        <div className="rounded-md border border-amber-400/40 bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">
              {selectedDay} 변경 이벤트 {selectedEvents.length}건 — 전/후 대조 (7일 창 내 평균)
            </h3>
            <button
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setSelectedDay(null)}
            >
              닫기
            </button>
          </div>
          <div className="space-y-2">
            {selectedEvents.map((e) => (
              <div key={e.id} className="text-xs text-muted-foreground">
                <span className="font-mono">{e.created_at.slice(11, 19)}</span>{' '}
                <span className="uppercase text-foreground">{e.source}</span>{' '}
                {e.git_sha && <span className="font-mono">{e.git_sha.slice(0, 8)}</span>}{' '}
                {e.note && <span>— {e.note}</span>}
                {e.diff && Object.keys(e.diff).length > 0 && (
                  <div className="mt-1 font-mono">
                    {Object.entries(e.diff).map(([k, v]) => (
                      <div key={k}>
                        {k}: {v.from ?? '∅'} → {v.to ?? '∅'}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="text-left py-1 pr-3">지표</th>
                  <th className="text-right py-1 pr-3">이전 평균</th>
                  <th className="text-right py-1">이후 평균</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {panels.map((p) => {
                  const { before, after } = beforeAfter(p.pick(d), selectedDay);
                  return (
                    <tr key={p.key} className="border-t border-border">
                      <td className="py-1 pr-3 text-muted-foreground">{p.title}</td>
                      <td className="py-1 pr-3 text-right">
                        {before != null ? Number(before.toFixed(2)) : '—'}
                      </td>
                      <td className="py-1 text-right text-foreground">
                        {after != null ? Number(after.toFixed(2)) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {d.weak_runs_7d.length > 0 && (
        <div className="rounded-md border border-border bg-card p-4">
          <h3 className="text-sm font-semibold text-foreground mb-2">
            빈약 run (7일, 카드 &lt; {d.thresholds['cardsP50Min']})
          </h3>
          <div className="space-y-1 text-xs text-muted-foreground">
            {d.weak_runs_7d.map((r) => (
              <div key={r.mandala_id} className="flex gap-3">
                <span className="font-mono">{r.created_at.slice(0, 16).replace('T', ' ')}</span>
                <span className="tabular-nums w-12">{r.cards}장</span>
                <span className="truncate">{r.goal ?? r.mandala_id}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── parameters tab ──────────────────────────────────────────────────────────

function ParamsTab({
  d,
  onEventPosted,
}: {
  d: AdminPerformanceDiagnosis;
  onEventPosted: () => void;
}) {
  const [note, setNote] = useState('');
  const [experiment, setExperiment] = useState<'' | 'candidate' | 'adopted' | 'reverted'>('');
  const postEvent = useMutation({
    mutationFn: () =>
      apiClient.postAdminPerformanceEvent({
        note,
        ...(experiment ? { experiment } : {}),
      }),
    onSuccess: () => {
      setNote('');
      setExperiment('');
      onEventPosted();
    },
  });

  const flags = Object.entries(d.current.flags).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border bg-card p-4">
        <h3 className="text-sm font-semibold text-foreground mb-1">수동 마커 (인시던트·실험)</h3>
        <p className="text-xs text-muted-foreground mb-2">
          외부 회귀(제공자 행 등)는 boot 이벤트가 없으므로 여기서 타임라인에 고정합니다.
        </p>
        <div className="flex gap-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="예: DeepInfra embed 25s 행 probe 확인 (외부 인시던트)"
            className="flex-1 px-2 py-1.5 rounded-md bg-background border border-border text-sm"
          />
          <select
            value={experiment}
            onChange={(e) => setExperiment(e.target.value as typeof experiment)}
            className="px-2 py-1.5 rounded-md bg-background border border-border text-sm"
          >
            <option value="">실험 아님</option>
            <option value="candidate">candidate</option>
            <option value="adopted">adopted</option>
            <option value="reverted">reverted</option>
          </select>
          <button
            onClick={() => postEvent.mutate()}
            disabled={!note.trim() || postEvent.isPending}
            className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50"
          >
            기록
          </button>
        </div>
        {postEvent.isError && (
          <p className="text-xs text-red-400 mt-1">
            기록 실패: {(postEvent.error as Error)?.message}
          </p>
        )}
      </div>

      <div className="rounded-md border border-border bg-card p-4">
        <h3 className="text-sm font-semibold text-foreground mb-2">
          변경 이벤트 (30일, {d.events_30d.length}건)
        </h3>
        <div className="space-y-1 text-xs max-h-72 overflow-y-auto">
          {d.events_30d.map((e) => (
            <div key={e.id} className="flex gap-2 text-muted-foreground">
              <span className="font-mono shrink-0">
                {e.created_at.slice(5, 16).replace('T', ' ')}
              </span>
              <span className="uppercase shrink-0 text-foreground">{e.source}</span>
              {e.git_sha && <span className="font-mono shrink-0">{e.git_sha.slice(0, 8)}</span>}
              {e.experiment && (
                <span className="shrink-0 px-1 rounded bg-amber-500/15 text-amber-400">
                  {e.experiment}
                </span>
              )}
              <span className="truncate">
                {e.note ??
                  (e.diff && Object.keys(e.diff).length > 0
                    ? Object.entries(e.diff)
                        .map(([k, v]) => `${k}:${v.from ?? '∅'}→${v.to ?? '∅'}`)
                        .join(' ')
                    : '(변경 flag 없음 — 이미지 교체)')}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-md border border-border bg-card p-4">
        <h3 className="text-sm font-semibold text-foreground mb-2">
          라이브 flag ({flags.length}개) · SHA{' '}
          <span className="font-mono">{d.current.git_sha?.slice(0, 8) ?? 'unknown'}</span>
        </h3>
        <div className="grid grid-cols-2 gap-x-6 gap-y-0.5 text-xs font-mono">
          {flags.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-2 border-b border-border/40 py-0.5">
              <span className="text-muted-foreground truncate">{k}</span>
              <span className="text-foreground shrink-0">{v}</span>
            </div>
          ))}
        </div>
      </div>

      <details className="rounded-md border border-border bg-card p-4">
        <summary className="text-sm font-semibold text-foreground cursor-pointer">
          Search Algorithm Versions (카탈로그)
        </summary>
        <div className="mt-2 -mx-4">
          <AdminSearchAlgorithms />
        </div>
      </details>
    </div>
  );
}

// ── page ────────────────────────────────────────────────────────────────────

export function AdminPerformanceMonitor() {
  const [tab, setTab] = useState<Tab>('timeline');
  const queryClient = useQueryClient();
  const { data, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: ['admin', 'performance-diagnosis'],
    queryFn: () => apiClient.getAdminPerformanceDiagnosis(),
    staleTime: 60_000,
  });

  return (
    <div className="p-6 max-w-6xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Performance Monitor</h1>
          {data && (
            <p className="text-xs text-muted-foreground mt-1">
              Generated {new Date(data.generated_at).toLocaleString()} · 진단 JSON:{' '}
              <span className="font-mono">/api/v1/admin/performance/diagnosis</span>
            </p>
          )}
        </div>
        <button
          onClick={() => void refetch()}
          disabled={isFetching}
          className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50"
        >
          <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
          Refresh
        </button>
      </div>

      <div className="flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'px-3 py-2 text-sm -mb-px border-b-2',
              tab === t.key
                ? 'border-primary text-foreground font-medium'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'timeline' && (
        <>
          {isError && (
            <div className="px-3 py-2 rounded-md bg-red-500/10 text-red-400 text-sm">
              진단 로드 실패: {(error as Error)?.message ?? 'unknown'}
            </div>
          )}
          {isLoading && !data && (
            <div className="px-3 py-2 rounded-md bg-muted/20 text-muted-foreground text-sm">
              Loading…
            </div>
          )}
          {data && <TimelineTab d={data} />}
        </>
      )}
      {tab === 'params' &&
        (data ? (
          <ParamsTab
            d={data}
            onEventPosted={() =>
              void queryClient.invalidateQueries({ queryKey: ['admin', 'performance-diagnosis'] })
            }
          />
        ) : (
          <div className="px-3 py-2 rounded-md bg-muted/20 text-muted-foreground text-sm">
            Loading…
          </div>
        ))}
      {tab === 'supply' && <AdminPoolHealth />}
      {tab === 'quality' && <AdminV2QualityAudit />}
    </div>
  );
}
