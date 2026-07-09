/**
 * Admin — Search-Trace Explorer (Observability G2)
 *
 * The debug-core view (design SSOT §6.2): pick a recent trace (or paste a
 * trace_id / mandala_id) → see the full Card Journey — generated queries →
 * raw YouTube counts → per-candidate keep/drop decision + reason → placed
 * cells. Backs GET /api/v1/admin/search-trace/* (read-only, observation-only).
 *
 * Operator-grade, not user-facing. Tailwind + semantic tokens only.
 */

import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '@/shared/lib/api-client';

interface TraceSummary {
  trace_id: string;
  mandala_id: string | null;
  user_id: string | null;
  trigger: string;
  started_at: string;
  finished_at: string | null;
  queries_generated: unknown;
  quota_units: number | null;
  queries_attempted: number | null;
  queries_succeeded: number | null;
  queries_failed: number | null;
  counts: Record<string, number> | null;
  outcome: Record<string, unknown> | null;
  algorithm_version: string | null;
  created_at: string;
}

interface Candidate {
  video_id: string;
  channel_title: string | null;
  source_kind: string;
  source_cell_index: number | null;
  source_query_text: string | null;
  source_tier: string | null;
  decision: string;
  drop_reason: string | null;
  relevance_gc: number | null;
  view_count: number | null;
  duration_sec: number | null;
  final_cell_index: number | null;
}

interface RawStep {
  step: string;
  status: string;
  request: unknown;
  response: unknown;
  error_message: string | null;
  latency_ms: number | null;
  at: string;
}

interface Journey {
  trace: TraceSummary;
  candidate_count: number;
  funnel: { decision: string; drop_reason: string | null; count: number }[];
  placed_by_cell: { cell: number; cards: Candidate[] }[];
  candidates: Candidate[];
  raw_steps: RawStep[];
}

const TRIGGER_TONE: Record<string, string> = {
  add_cards: 'bg-primary/15 text-primary',
  wizard: 'bg-accent text-accent-foreground',
  pool_serve: 'bg-muted text-muted-foreground',
};

function Pill({ children, tone }: { children: React.ReactNode; tone?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tone ?? 'bg-muted text-muted-foreground'}`}
    >
      {children}
    </span>
  );
}

function fmtTime(iso: string): string {
  return iso.replace('T', ' ').replace(/\.\d+Z$/, 'Z');
}

export function AdminSearchTraceExplorer() {
  const [recent, setRecent] = useState<TraceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [idInput, setIdInput] = useState('');
  const [journey, setJourney] = useState<Journey | null>(null);
  const [journeyLoading, setJourneyLoading] = useState(false);
  // Raw req/rep popup — full flow start→end (James request).
  const [rawOpen, setRawOpen] = useState(false);

  const reloadRecent = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.getSearchTraceRecent();
      setRecent(res.traces);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load traces');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reloadRecent();
  }, [reloadRecent]);

  const openJourney = useCallback(async (traceId: string) => {
    if (!traceId.trim()) return;
    setJourneyLoading(true);
    setError(null);
    try {
      const res = await apiClient.getSearchTraceJourney(traceId.trim());
      setJourney(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load journey');
      setJourney(null);
    } finally {
      setJourneyLoading(false);
    }
  }, []);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border bg-card px-6 py-4">
        <h1 className="text-lg font-semibold">Search-Trace Explorer</h1>
        <p className="text-sm text-muted-foreground">
          Card Journey — 쿼리 → raw → keep/drop 사유 → 셀. 관찰 전용 (서빙 무변경).
        </p>
        <div className="mt-3 flex gap-2">
          <input
            value={idInput}
            onChange={(e) => setIdInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void openJourney(idInput);
            }}
            placeholder="trace_id 붙여넣기 → Enter"
            className="w-96 rounded-md border border-input bg-background px-3 py-1.5 text-sm"
          />
          <button
            onClick={() => void openJourney(idInput)}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-accent"
          >
            여정 조회
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left — recent traces */}
        <aside className="w-80 shrink-0 overflow-y-auto border-r border-border">
          <div className="border-b border-border px-4 py-2 text-xs font-medium text-muted-foreground">
            최근 요청 ({recent.length})
          </div>
          {loading && <div className="px-4 py-3 text-sm text-muted-foreground">로딩…</div>}
          {recent.map((t) => (
            <button
              key={t.trace_id}
              onClick={() => {
                setIdInput(t.trace_id);
                void openJourney(t.trace_id);
              }}
              className={`w-full border-b border-border px-4 py-2 text-left hover:bg-accent ${
                journey?.trace.trace_id === t.trace_id ? 'bg-accent' : ''
              }`}
            >
              <div className="flex items-center justify-between">
                <Pill tone={TRIGGER_TONE[t.trigger]}>{t.trigger}</Pill>
                <span className="text-xs text-muted-foreground">
                  {(t.outcome?.cards_count as number | undefined) ?? '?'}장 · {t.quota_units ?? '?'}
                  u
                </span>
              </div>
              <div className="mt-1 truncate text-xs text-muted-foreground">
                {fmtTime(t.created_at)}
              </div>
              <div className="truncate font-mono text-[11px] text-muted-foreground">
                {t.trace_id}
              </div>
            </button>
          ))}
        </aside>

        {/* Right — journey */}
        <main className="flex-1 overflow-y-auto p-6">
          {error && (
            <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
          {journeyLoading && <div className="text-sm text-muted-foreground">여정 로딩…</div>}
          {!journey && !journeyLoading && (
            <div className="text-sm text-muted-foreground">
              왼쪽에서 요청을 선택하거나 trace_id 를 입력하세요.
            </div>
          )}
          {journey && (
            <div className="space-y-6">
              {/* Request summary */}
              <section className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-center gap-2">
                  <Pill tone={TRIGGER_TONE[journey.trace.trigger]}>{journey.trace.trigger}</Pill>
                  <span className="text-sm text-muted-foreground">
                    {fmtTime(journey.trace.started_at)}
                  </span>
                  {journey.trace.algorithm_version && (
                    <Pill>{journey.trace.algorithm_version}</Pill>
                  )}
                  <button
                    type="button"
                    onClick={() => setRawOpen(true)}
                    disabled={!journey.raw_steps?.length}
                    className="ml-auto rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-40"
                    title="이 flow의 전체 req/rep 원본 (시작→끝)"
                  >
                    req/rep 로그 ({journey.raw_steps?.length ?? 0})
                  </button>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
                  <div>
                    <span className="text-muted-foreground">quota</span>{' '}
                    {journey.trace.quota_units ?? '—'}u
                  </div>
                  <div>
                    <span className="text-muted-foreground">쿼리</span>{' '}
                    {journey.trace.queries_succeeded ?? '?'}/
                    {journey.trace.queries_attempted ?? '?'} 성공
                  </div>
                  <div>
                    <span className="text-muted-foreground">후보</span> {journey.candidate_count}
                  </div>
                  <div>
                    <span className="text-muted-foreground">카드</span>{' '}
                    {(journey.trace.outcome?.cards_count as number | undefined) ?? '?'}
                  </div>
                </div>
                {journey.trace.counts && (
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    {Object.entries(journey.trace.counts).map(([k, v]) => (
                      <span key={k} className="rounded bg-muted px-1.5 py-0.5">
                        {k}: {v}
                      </span>
                    ))}
                  </div>
                )}
              </section>

              {/* Generated queries */}
              {Array.isArray(journey.trace.queries_generated) && (
                <section>
                  <h2 className="mb-2 text-sm font-semibold">생성 쿼리 → raw</h2>
                  <div className="space-y-1">
                    {(
                      journey.trace.queries_generated as {
                        query: string;
                        source?: string;
                        rawCount?: number;
                        cellIndex?: number;
                      }[]
                    ).map((q, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2 rounded border border-border px-3 py-1.5 text-sm"
                      >
                        <span className="w-8 shrink-0 text-xs text-muted-foreground">
                          c{q.cellIndex ?? '?'}
                        </span>
                        <span className="flex-1 truncate">{q.query}</span>
                        {q.source && <Pill>{q.source}</Pill>}
                        <span
                          className={`w-14 text-right text-xs ${(q.rawCount ?? 0) < 10 ? 'text-destructive' : 'text-muted-foreground'}`}
                        >
                          raw {q.rawCount ?? 0}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Funnel */}
              <section>
                <h2 className="mb-2 text-sm font-semibold">퍼널 (decision × drop 사유)</h2>
                <div className="flex flex-wrap gap-2">
                  {journey.funnel.map((f) => (
                    <span
                      key={`${f.decision}:${f.drop_reason}`}
                      className={`rounded-md px-2 py-1 text-xs ${
                        f.decision === 'PLACED'
                          ? 'bg-primary/15 text-primary'
                          : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {f.decision === 'PLACED' ? 'PLACED' : `drop:${f.drop_reason ?? '?'}`} ·{' '}
                      {f.count}
                    </span>
                  ))}
                </div>
              </section>

              {/* Placed cards by cell */}
              <section>
                <h2 className="mb-2 text-sm font-semibold">배치된 카드 (셀별)</h2>
                {journey.placed_by_cell.length === 0 && (
                  <div className="text-sm text-muted-foreground">배치된 카드 없음.</div>
                )}
                {journey.placed_by_cell.map(({ cell, cards }) => (
                  <div key={cell} className="mb-3">
                    <div className="mb-1 text-xs font-medium text-muted-foreground">
                      cell {cell}
                    </div>
                    <div className="overflow-hidden rounded-md border border-border">
                      <table className="w-full text-sm">
                        <tbody>
                          {cards.map((c) => (
                            <tr key={c.video_id} className="border-b border-border last:border-0">
                              <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">
                                {c.video_id}
                              </td>
                              <td className="max-w-[220px] truncate px-3 py-1.5">
                                {c.channel_title ?? '—'}
                              </td>
                              <td
                                className={`px-3 py-1.5 text-right ${(c.view_count ?? 0) < 1000 ? 'text-destructive' : ''}`}
                              >
                                {c.view_count ?? '?'} views
                              </td>
                              <td className="px-3 py-1.5 text-right text-xs text-muted-foreground">
                                gc {c.relevance_gc ?? '—'} · {c.source_kind}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </section>
            </div>
          )}
        </main>
      </div>

      {/* Raw req/rep popup — the full flow start→end (recordTrace steps). */}
      {rawOpen && journey && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setRawOpen(false)}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="text-sm font-semibold">
                req/rep 로그 — {journey.trace.trigger} · {journey.raw_steps.length} steps
                <span className="ml-2 font-mono text-xs text-muted-foreground">
                  {journey.trace.trace_id}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setRawOpen(false)}
                className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3">
              {journey.raw_steps.length === 0 && (
                <div className="text-sm text-muted-foreground">
                  이 flow에 기록된 raw step이 없습니다.
                </div>
              )}
              {journey.raw_steps.map((s, i) => (
                <details
                  key={`${s.step}-${i}`}
                  className="mb-2 rounded-md border border-border"
                  open={s.status !== 'ok'}
                >
                  <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm">
                    <span className="font-mono text-xs text-muted-foreground">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span className="font-medium">{s.step}</span>
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs ${s.status === 'ok' ? 'bg-muted text-muted-foreground' : 'bg-destructive/15 text-destructive'}`}
                    >
                      {s.status}
                    </span>
                    {s.latency_ms != null && (
                      <span className="text-xs text-muted-foreground">{s.latency_ms}ms</span>
                    )}
                    <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                      {fmtTime(s.at)}
                    </span>
                  </summary>
                  <div className="space-y-2 border-t border-border px-3 py-2">
                    {s.error_message && (
                      <div className="rounded bg-destructive/10 px-2 py-1 text-xs text-destructive">
                        {s.error_message}
                      </div>
                    )}
                    <div>
                      <div className="mb-1 text-xs font-semibold text-muted-foreground">
                        request
                      </div>
                      <pre className="max-h-64 overflow-auto rounded bg-muted/50 p-2 text-[11px] leading-relaxed">
                        {s.request == null ? '—' : JSON.stringify(s.request, null, 2)}
                      </pre>
                    </div>
                    <div>
                      <div className="mb-1 text-xs font-semibold text-muted-foreground">
                        response
                      </div>
                      <pre className="max-h-80 overflow-auto rounded bg-muted/50 p-2 text-[11px] leading-relaxed">
                        {s.response == null ? '—' : JSON.stringify(s.response, null, 2)}
                      </pre>
                    </div>
                  </div>
                </details>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
