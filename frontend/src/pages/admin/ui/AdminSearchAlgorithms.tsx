/**
 * Admin — Search Algorithm Versions (CP488)
 *
 * Catalog browser + editor + per-mandala override + A/B comparison view.
 * Backs the BE endpoints under /api/v1/admin/search-algorithms shipped in
 * PR #749. Read-fresh-per-run (no FE cache, no env swap) — saving a row
 * flips on the next v3 executor invocation.
 *
 * UX flow (kept minimal so the screen is operator-grade, not user-facing):
 *   1. List all rows; the single `is_active=true` is highlighted.
 *   2. "+ New version" opens a modal with id + display + JSON parameters.
 *   3. Click a row → drawer with editable display/description/parameters +
 *      "Set Active" button (atomic flip in BE).
 *   4. Bottom section: per-mandala override input (mandalaId + dropdown).
 *   5. Bottom section: comparison fetch — paste mandalaId, see run rollup
 *      per algorithm_version (count / avg duration / total cost).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { apiClient } from '@/shared/lib/api-client';

interface AlgorithmRow {
  id: string;
  display_name: string;
  description: string | null;
  parameters: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
  created_by: string | null;
}

interface ComparisonRow {
  algorithm_version: string | null;
  run_count: number;
  avg_duration_ms: number | null;
  recent_run_at: string | null;
  total_cost: unknown;
}

const ID_HINT = 'slug-style: v2-strict-gate / v3-category-target';

export function AdminSearchAlgorithms() {
  const [rows, setRows] = useState<AlgorithmRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  // Per-mandala override + comparison
  const [mandalaIdInput, setMandalaIdInput] = useState('');
  const [comparison, setComparison] = useState<ComparisonRow[] | null>(null);
  const [comparisonLoading, setComparisonLoading] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.listSearchAlgorithms();
      setRows(res.data.versions);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load algorithms');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const selected = useMemo(() => rows.find((r) => r.id === selectedId) ?? null, [rows, selectedId]);

  async function handleSetActive(id: string) {
    try {
      await apiClient.updateSearchAlgorithm(id, { is_active: true });
      toast.success(`'${id}' 이 새 활성 버전이 되었습니다`);
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'flip failed');
    }
  }

  async function handleMandalaOverride(algorithmVersion: string | null) {
    if (!mandalaIdInput.trim()) {
      toast.error('mandala_id 를 입력하세요');
      return;
    }
    try {
      await apiClient.setMandalaAlgorithm(mandalaIdInput.trim(), algorithmVersion);
      toast.success(
        algorithmVersion === null
          ? `만다라 ${mandalaIdInput.slice(0, 8)}… override 해제`
          : `만다라 ${mandalaIdInput.slice(0, 8)}… → '${algorithmVersion}'`
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'override failed');
    }
  }

  async function handleComparisonFetch() {
    if (!mandalaIdInput.trim()) {
      toast.error('mandala_id 를 입력하세요');
      return;
    }
    setComparisonLoading(true);
    setComparison(null);
    try {
      const res = await apiClient.getAlgorithmComparison(mandalaIdInput.trim());
      setComparison(res.data.comparison);
      if (res.data.comparison.length === 0) {
        toast.info('해당 만다라의 run 이 없습니다');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'comparison failed');
    } finally {
      setComparisonLoading(false);
    }
  }

  if (loading) {
    return <div className="p-8 text-sm text-muted-foreground">불러오는 중...</div>;
  }
  if (error) {
    return (
      <div className="p-8 text-sm text-destructive">
        오류: {error}
        <button type="button" className="ml-2 underline" onClick={() => void reload()}>
          재시도
        </button>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Search Algorithm Versions</h1>
          <p className="text-sm text-muted-foreground mt-1">
            v3 discovery 의 algorithm 카탈로그. 활성 row 변경 시 다음 검색 호출부터 즉시 적용 (no
            restart). 만다라별 override 가능.
          </p>
        </div>
        <button
          type="button"
          className="bg-primary text-primary-foreground hover:opacity-90 px-4 py-2 rounded text-sm font-medium"
          onClick={() => setShowCreate(true)}
        >
          + New version
        </button>
      </div>

      {/* Catalog table */}
      <div className="border rounded">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left p-2">id</th>
              <th className="text-left p-2">display_name</th>
              <th className="text-left p-2">active</th>
              <th className="text-left p-2">created_at</th>
              <th className="text-left p-2">action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                className={`border-t hover:bg-accent/30 cursor-pointer ${
                  selectedId === r.id ? 'bg-accent/40' : ''
                }`}
                onClick={() => setSelectedId(r.id)}
              >
                <td className="p-2 font-mono">{r.id}</td>
                <td className="p-2">{r.display_name}</td>
                <td className="p-2">
                  {r.is_active ? (
                    <span className="inline-block bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 rounded text-xs">
                      ACTIVE
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="text-xs underline text-muted-foreground hover:text-foreground"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleSetActive(r.id);
                      }}
                    >
                      Set Active
                    </button>
                  )}
                </td>
                <td className="p-2 text-xs text-muted-foreground font-mono">
                  {r.created_at.slice(0, 16).replace('T', ' ')}
                </td>
                <td className="p-2">
                  <span className="text-xs text-muted-foreground">click row →</span>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="p-4 text-center text-muted-foreground">
                  (no rows)
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Selected row editor */}
      {selected && (
        <SelectedEditor
          row={selected}
          onSaved={() => void reload()}
          onClose={() => setSelectedId(null)}
        />
      )}

      {/* Per-mandala override + comparison */}
      <div className="border rounded p-4 space-y-3">
        <h2 className="text-lg font-semibold">Per-mandala override + A/B comparison</h2>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="mandala uuid"
            value={mandalaIdInput}
            onChange={(e) => setMandalaIdInput(e.target.value)}
            className="flex-1 border rounded px-2 py-1 font-mono text-xs"
          />
          <select
            className="border rounded px-2 py-1 text-xs"
            defaultValue=""
            onChange={(e) => {
              const v = e.target.value;
              if (v === '__clear__') {
                void handleMandalaOverride(null);
              } else if (v) {
                void handleMandalaOverride(v);
              }
              e.currentTarget.value = '';
            }}
          >
            <option value="">override → 선택</option>
            <option value="__clear__">(clear / use global)</option>
            {rows.map((r) => (
              <option key={r.id} value={r.id}>
                {r.id}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="border rounded px-3 py-1 text-xs hover:bg-accent"
            onClick={() => void handleComparisonFetch()}
            disabled={comparisonLoading}
          >
            {comparisonLoading ? '...' : 'A/B comparison'}
          </button>
        </div>
        {comparison && comparison.length > 0 && (
          <div className="border rounded">
            <table className="w-full text-xs">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-2">algorithm_version</th>
                  <th className="text-right p-2">run_count</th>
                  <th className="text-right p-2">avg_duration_ms</th>
                  <th className="text-left p-2">recent_run_at</th>
                  <th className="text-left p-2">total_cost</th>
                </tr>
              </thead>
              <tbody>
                {comparison.map((c, i) => (
                  <tr key={i} className="border-t">
                    <td className="p-2 font-mono">{c.algorithm_version ?? '(NULL)'}</td>
                    <td className="p-2 text-right">{c.run_count}</td>
                    <td className="p-2 text-right">{c.avg_duration_ms ?? '—'}</td>
                    <td className="p-2 text-xs text-muted-foreground">
                      {c.recent_run_at ? c.recent_run_at.slice(0, 16).replace('T', ' ') : '—'}
                    </td>
                    <td className="p-2 text-xs font-mono break-all">
                      {c.total_cost == null ? '—' : JSON.stringify(c.total_cost).slice(0, 200)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create modal */}
      {showCreate && (
        <CreateModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            void reload();
          }}
        />
      )}
    </div>
  );
}

// =========================================================================
// SelectedEditor — drawer-like inline editor for a single row
// =========================================================================

function SelectedEditor(props: { row: AlgorithmRow; onSaved: () => void; onClose: () => void }) {
  const { row, onSaved, onClose } = props;
  const [displayName, setDisplayName] = useState(row.display_name);
  const [description, setDescription] = useState(row.description ?? '');
  const [parametersText, setParametersText] = useState(JSON.stringify(row.parameters, null, 2));
  const [parseError, setParseError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDisplayName(row.display_name);
    setDescription(row.description ?? '');
    setParametersText(JSON.stringify(row.parameters, null, 2));
    setParseError(null);
  }, [row]);

  async function handleSave() {
    let parameters: Record<string, unknown>;
    try {
      const parsed = JSON.parse(parametersText);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('parameters must be a JSON object');
      }
      parameters = parsed as Record<string, unknown>;
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'JSON parse failed');
      return;
    }
    setParseError(null);
    setSaving(true);
    try {
      await apiClient.updateSearchAlgorithm(row.id, {
        display_name: displayName,
        description: description.length > 0 ? description : null,
        parameters,
      });
      toast.success(`'${row.id}' 저장됨`);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border rounded p-4 space-y-3 bg-accent/10">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold font-mono">{row.id}</h2>
        <button type="button" className="text-sm underline text-muted-foreground" onClick={onClose}>
          닫기
        </button>
      </div>
      <div>
        <label className="block text-xs text-muted-foreground mb-1">display_name</label>
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className="w-full border rounded px-2 py-1 text-sm"
        />
      </div>
      <div>
        <label className="block text-xs text-muted-foreground mb-1">description</label>
        <textarea
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full border rounded px-2 py-1 text-sm"
        />
      </div>
      <div>
        <label className="block text-xs text-muted-foreground mb-1">parameters (JSON object)</label>
        <textarea
          rows={14}
          value={parametersText}
          onChange={(e) => setParametersText(e.target.value)}
          className="w-full border rounded px-2 py-1 text-xs font-mono"
          spellCheck={false}
        />
        {parseError && <p className="text-xs text-destructive mt-1">JSON 오류: {parseError}</p>}
      </div>
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          className="border rounded px-3 py-1 text-sm hover:bg-accent"
          onClick={onClose}
          disabled={saving}
        >
          취소
        </button>
        <button
          type="button"
          className="bg-primary text-primary-foreground hover:opacity-90 rounded px-4 py-1 text-sm font-medium"
          onClick={() => void handleSave()}
          disabled={saving}
        >
          {saving ? '저장 중...' : '저장'}
        </button>
      </div>
    </div>
  );
}

// =========================================================================
// CreateModal — new algorithm row
// =========================================================================

function CreateModal(props: { onClose: () => void; onCreated: () => void }) {
  const { onClose, onCreated } = props;
  const [id, setId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [parametersText, setParametersText] = useState('{\n  \n}');
  const [setActive, setSetActive] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleCreate() {
    let parameters: Record<string, unknown>;
    try {
      const parsed = JSON.parse(parametersText);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('parameters must be a JSON object');
      }
      parameters = parsed as Record<string, unknown>;
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'JSON parse failed');
      return;
    }
    setParseError(null);
    setSaving(true);
    try {
      await apiClient.createSearchAlgorithm({
        id: id.trim(),
        display_name: displayName,
        description: description.length > 0 ? description : null,
        parameters,
        is_active: setActive,
      });
      toast.success(`'${id}' 생성됨`);
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'create failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-background border rounded-lg max-w-2xl w-full p-5 space-y-3 max-h-[85vh] overflow-auto">
        <h2 className="text-lg font-semibold">New search algorithm version</h2>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">id</label>
          <input
            type="text"
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder={ID_HINT}
            className="w-full border rounded px-2 py-1 text-sm font-mono"
            autoFocus
          />
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">display_name</label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full border rounded px-2 py-1 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">description</label>
          <textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full border rounded px-2 py-1 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">
            parameters (JSON object) — copy from active row + edit
          </label>
          <textarea
            rows={12}
            value={parametersText}
            onChange={(e) => setParametersText(e.target.value)}
            className="w-full border rounded px-2 py-1 text-xs font-mono"
            spellCheck={false}
          />
          {parseError && <p className="text-xs text-destructive mt-1">JSON 오류: {parseError}</p>}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={setActive}
            onChange={(e) => setSetActive(e.target.checked)}
          />
          저장 즉시 활성 (기존 active row 자동 비활성)
        </label>
        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            className="border rounded px-3 py-1 text-sm hover:bg-accent"
            onClick={onClose}
            disabled={saving}
          >
            취소
          </button>
          <button
            type="button"
            className="bg-primary text-primary-foreground hover:opacity-90 rounded px-4 py-1 text-sm font-medium"
            onClick={() => void handleCreate()}
            disabled={saving || !id.trim() || !displayName.trim()}
          >
            {saving ? '생성 중...' : '생성'}
          </button>
        </div>
      </div>
    </div>
  );
}
