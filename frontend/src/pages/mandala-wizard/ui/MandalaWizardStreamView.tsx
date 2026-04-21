/**
 * MandalaWizardStreamView — Phase 1 streaming wizard UI.
 *
 * Flag-gated alternative to the legacy step-1/2/3 `MandalaWizardPage`
 * flow. Consumes `useWizardStream` and navigates to the newly-created
 * mandala as soon as the backend streams `mandala_saved`.
 *
 * Scope (deliberately narrow, to minimize regression risk):
 *
 *   - Goal input only (Step 1 equivalent). Focus tags + target level
 *     are legacy-only for now; streaming path does not send them.
 *   - Templates arrive via SSE and render as a read-only hint column
 *     ("비슷한 만다라") while the AI structure generates in parallel.
 *     No click-to-pick template in the streaming flow — to avoid
 *     the design complexity of cancelling the auto-saving stream
 *     when the user chooses a template. Legacy wizard remains the
 *     path for "pick a template" users (`VITE_WIZARD_STREAMING_ENABLED=false`).
 *   - On `mandala_saved`, navigate to `/mandalas/:id/edit` and let the
 *     dashboard handle cards (P2 will SSE-wire the main grid too).
 *   - Cancel button → `cancel()` + return to idle goal input.
 *
 * Legacy `MandalaWizardPage` is untouched; the parent decides which
 * view to mount based on the flag.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useWizardStream } from '@/features/mandala-wizard';

export function MandalaWizardStreamView(): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const stream = useWizardStream();
  const [goalInput, setGoalInput] = useState<string>('');

  // As soon as the backend persists the mandala, jump to its edit
  // page. Cards continue to arrive via SSE but the dashboard manages
  // that — we don't wait for `complete`.
  useEffect(() => {
    if (stream.mandalaId) {
      navigate(`/mandalas/${stream.mandalaId}/edit`);
    }
  }, [stream.mandalaId, navigate]);

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    const trimmed = goalInput.trim();
    if (!trimmed) return;
    stream.start(trimmed, 'ko');
  };

  const busy = stream.status === 'connecting' || stream.status === 'streaming';

  return (
    <div className="mx-auto max-w-[720px] px-6 py-10">
      <div className="mb-10 text-[10px] font-bold uppercase tracking-[2px] text-foreground/[0.08]">
        /mandalas/new
      </div>

      <form onSubmit={handleSubmit} className="mb-6">
        <label
          htmlFor="wizard-stream-goal"
          className="mb-2 block text-[13px] font-semibold text-foreground"
        >
          {t('wizard.streamGoalLabel', 'What goal do you want to reach?')}
        </label>
        <div className="flex gap-2">
          <input
            id="wizard-stream-goal"
            type="text"
            value={goalInput}
            onChange={(e) => setGoalInput(e.target.value)}
            placeholder={t('wizard.streamGoalPlaceholder', '예: 건강한 몸 만들기')}
            disabled={busy}
            className="flex-1 rounded-lg border border-border bg-card px-4 py-3 text-[14px] text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none disabled:opacity-50"
          />
          {busy ? (
            <button
              type="button"
              onClick={stream.cancel}
              className="rounded-lg border border-border bg-card px-4 py-2 text-[13px] font-semibold text-foreground transition-colors hover:bg-foreground/[0.04]"
            >
              {t('common.cancel', 'Cancel')}
            </button>
          ) : (
            <button
              type="submit"
              disabled={!goalInput.trim()}
              className="rounded-lg bg-primary px-4 py-2 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {t('wizard.streamSubmit', 'Start')}
            </button>
          )}
        </div>
      </form>

      {/* Status + observed durations — real server timings, not guesses. */}
      {busy && (
        <div className="mb-4 rounded-lg border border-border/60 bg-card px-4 py-3 text-[12px] text-muted-foreground">
          <div className="mb-1 font-semibold text-foreground">
            {t('wizard.streamStatusRunning', 'Generating in parallel...')}
          </div>
          <ul className="space-y-1 tabular-nums">
            <li>template: {stream.durations.template ? `${stream.durations.template}ms` : '…'}</li>
            <li>
              structure: {stream.durations.structure ? `${stream.durations.structure}ms` : '…'}
            </li>
            {stream.durations.mandalaSaved !== undefined && (
              <li>saved: {stream.durations.mandalaSaved}ms (navigating...)</li>
            )}
          </ul>
        </div>
      )}

      {/* Template hint (read-only in streaming mode). */}
      {stream.templates.length > 0 && !stream.mandalaId && (
        <div className="mb-6">
          <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t('wizard.streamTemplatesHint', 'Similar existing mandalas')}
          </h3>
          <ul className="space-y-2">
            {stream.templates.map((tmpl) => (
              <li
                key={tmpl.mandalaId}
                className="rounded-lg border border-border/60 bg-card px-4 py-2 text-[13px] text-foreground"
              >
                {tmpl.center_label || tmpl.center_goal}
                <span className="ml-2 text-[10px] text-muted-foreground tabular-nums">
                  {(tmpl.similarity * 100).toFixed(0)}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Error state — with Retry (restart the stream). */}
      {stream.status === 'error' && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-center text-sm text-destructive">
          <p className="mb-3">
            {stream.error || t('wizard.streamErrorGeneric', 'Something went wrong.')}
          </p>
          <button
            type="button"
            onClick={() => {
              const trimmed = goalInput.trim();
              if (trimmed) stream.start(trimmed, 'ko');
            }}
            className="rounded-lg bg-primary px-4 py-2 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t('common.retry', 'Retry')}
          </button>
        </div>
      )}
    </div>
  );
}

export default MandalaWizardStreamView;
