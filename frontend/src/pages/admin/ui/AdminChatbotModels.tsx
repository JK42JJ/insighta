/**
 * Admin page for setting per-provider chatbot model overrides.
 *
 * Resolver order (top wins, displayed in the UI for transparency):
 *   1. CHATBOT_MODEL env (operator-set, no UI control here)
 *   2. this admin override (per-provider, editable here)
 *   3. per-provider hardcoded default
 *
 * CP475+3 — admin UI dynamic chatbot model control.
 */

import { useEffect, useState } from 'react';
import { apiClient, type AdminChatbotModelsResponse } from '@/shared/lib/api-client';
import { toast } from 'sonner';

interface FormState {
  qwenRunpodModel: string;
  openrouterModel: string;
}

const EMPTY_FORM: FormState = { qwenRunpodModel: '', openrouterModel: '' };

export function AdminChatbotModels() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<AdminChatbotModelsResponse | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await apiClient.getAdminChatbotModels();
        if (cancelled) return;
        setData(res);
        setForm({
          qwenRunpodModel: res.qwenRunpodModel ?? '',
          openrouterModel: res.openrouterModel ?? '',
        });
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'failed to load chatbot settings');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      // Empty string is sent through — BE normalises to null (clear override).
      const res = await apiClient.setAdminChatbotModels({
        qwenRunpodModel: form.qwenRunpodModel.length === 0 ? null : form.qwenRunpodModel,
        openrouterModel: form.openrouterModel.length === 0 ? null : form.openrouterModel,
      });
      // Reflect server-normalised values back into the form + summary.
      setData((prev) =>
        prev
          ? {
              ...prev,
              qwenRunpodModel: res.qwenRunpodModel,
              openrouterModel: res.openrouterModel,
              updatedAt: res.updatedAt,
              updatedBy: res.updatedBy,
            }
          : prev
      );
      setForm({
        qwenRunpodModel: res.qwenRunpodModel ?? '',
        openrouterModel: res.openrouterModel ?? '',
      });
      toast.success('챗봇 모델 설정 저장됨');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'save failed';
      setError(msg);
      toast.error(`저장 실패: ${msg}`);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="p-6 text-muted-foreground">불러오는 중…</div>;
  }

  if (error && !data) {
    return <div className="p-6 text-destructive">에러: {error}</div>;
  }

  if (!data) {
    return null;
  }

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <header>
        <h1 className="text-2xl font-semibold">챗봇 모델 설정</h1>
        <p className="text-sm text-muted-foreground mt-1">
          provider 별로 사용할 모델명을 지정합니다. 비워두면 환경변수 또는 코드 기본값으로 fallback.
          변경은 즉시 prod 챗봇에 반영됩니다 (재배포 불필요).
        </p>
      </header>

      {data.envExplicit && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <strong>주의:</strong> 환경변수 <code>CHATBOT_MODEL={data.envExplicit}</code>가 설정되어
          있어 모든 provider 의 admin 설정을 덮어씁니다. 동적 제어를 사용하려면 이 환경변수를
          제거하세요.
        </div>
      )}

      <section className="space-y-2">
        <label className="block">
          <span className="text-sm font-medium">qwen-runpod 모델</span>
          <input
            type="text"
            value={form.qwenRunpodModel}
            onChange={(e) => setForm((f) => ({ ...f, qwenRunpodModel: e.target.value }))}
            placeholder={data.defaults.qwenRunpod}
            className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <span className="text-xs text-muted-foreground">
            기본값: <code>{data.defaults.qwenRunpod}</code> · vLLM <code>--served-model-name</code>.
            비워두면 기본값 사용.
          </span>
        </label>

        <label className="block">
          <span className="text-sm font-medium">openrouter 모델</span>
          <input
            type="text"
            value={form.openrouterModel}
            onChange={(e) => setForm((f) => ({ ...f, openrouterModel: e.target.value }))}
            placeholder={data.defaults.openrouter}
            className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <span className="text-xs text-muted-foreground">
            기본값: <code>{data.defaults.openrouter}</code> · OpenRouter 모델 id (예{' '}
            <code>anthropic/claude-3.5-sonnet</code>). 비워두면 기본값 사용.
          </span>
        </label>
      </section>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {saving ? '저장 중…' : '저장'}
        </button>
        {data.updatedAt && (
          <span className="text-xs text-muted-foreground">
            마지막 변경: {new Date(data.updatedAt).toLocaleString('ko-KR')}
            {data.updatedBy && ` · ${data.updatedBy.slice(0, 8)}…`}
          </span>
        )}
      </div>

      {error && <div className="text-sm text-destructive">에러: {error}</div>}
    </div>
  );
}
