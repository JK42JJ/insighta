import { useCallback, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Ban } from 'lucide-react';
import {
  useWizard,
  WizardStepper,
  WizardStepGoal,
  WizardStepContext,
} from '@/features/mandala-wizard';
import { MandalaWizardStreamView } from './MandalaWizardStreamView';
import { useMandalaQuota } from '@/features/mandala';
import type { PendingMandalaInputs } from '@/stores/mandalaStore';

/**
 * Feature flag: legacy `useWizard` flow (template + AI pick, 3-step UX)
 * is the default. Set `VITE_WIZARD_STREAMING_ENABLED=true` at build time
 * to mount the streaming flow built on POST /wizard-stream.
 *
 * Default flipped 2026-04-22 after critical incident: the streaming view
 * (MandalaWizardStreamView) is deliberately narrow — no stepper, no
 * template-pick, no focus tags, no sidebar navigation. When activated via
 * PR #441 (PWA autoUpdate), users got stuck on a wizard page with no way
 * back to the dashboard. Until streaming view reaches feature parity with
 * the legacy wizard, keep the default off.
 */
const WIZARD_STREAMING_ENABLED = import.meta.env.VITE_WIZARD_STREAMING_ENABLED === 'true';

/**
 * Shape pushed by `fireCreateMandala` on failure via
 * `navigate('/mandalas/new', { state: { restoreInputs, errorMessage } })`.
 */
interface RestoreState {
  restoreInputs?: PendingMandalaInputs;
  errorMessage?: string;
}

export default function MandalaWizardPage() {
  // Flag-gated streaming path. Early return so the legacy hook
  // + state below never run when streaming is active (zero risk
  // of double-fetching, double-state, or state-desync between
  // the two flows).
  if (WIZARD_STREAMING_ENABLED) {
    return <MandalaWizardStreamView />;
  }

  const { t } = useTranslation();
  const wizard = useWizard();
  const location = useLocation();
  const navigate = useNavigate();

  // Re-hydrate wizard inputs after a background create failed and bounced the
  // user back here. We consume the navigation state exactly once and then
  // strip it so a subsequent refresh does not re-trigger the restore.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    const restore = (location.state as RestoreState | null)?.restoreInputs;
    if (!restore) return;
    restoredRef.current = true;
    // Goal text: users identify their own wizard by this field. Focus tags and
    // target level are cheap to restore; the AI-generated preview is NOT
    // restored because it was the output of a separate LLM call and the user
    // will re-run it intentionally on retry.
    wizard.setGoalInput(restore.centerGoal || restore.title);
    if (restore.focusTags?.length) wizard.setFocusTags(restore.focusTags);
    if (restore.targetLevel) wizard.setTargetLevel(restore.targetLevel);
    // Clear the navigation state so page refresh doesn't repeat the restore.
    navigate(location.pathname, { replace: true, state: null });
  }, [location, navigate, wizard]);
  const { data: quota, isLoading: quotaLoading } = useMandalaQuota();
  const quotaReached =
    !quotaLoading && quota?.limit !== null && quota?.limit !== undefined && quota.remaining === 0;
  // Daily cap (per-day creation limit, separate from total quota). Admins bypass.
  const dailyReached =
    !quotaLoading && quota?.daily && !quota.daily.isAdmin && quota.daily.remaining === 0;

  // Step 1: goal input only → Go saves goal + moves to Step 2
  const handleGoalGo = useCallback(
    (goal: string) => {
      wizard.setGoalInput(goal);
      wizard.goToStep(2);
    },
    [wizard]
  );

  // Step 2: context → Continue triggers search+generate + moves to Step 3
  const handleContextContinue = useCallback(() => {
    wizard.submitGoal(wizard.goalInput);
    wizard.goToStep(3);
  }, [wizard]);

  // Step 3: selecting a result → auto-complete (create mandala)
  const handleSelectAndComplete = useCallback(
    (...args: Parameters<typeof wizard.selectSearchResult>) => {
      wizard.selectSearchResult(...args);
      // complete() will be called after selectedTemplate is set
      // Use setTimeout to ensure state update completes first
      setTimeout(() => wizard.complete(), 0);
    },
    [wizard]
  );

  // Delegate to the atomic wizard helper — it constructs the template and
  // passes it directly to `complete`, avoiding the prior setState race that
  // forced users to double-click the AI-custom card.
  const handleSelectGeneratedAndComplete = useCallback(
    (...args: Parameters<typeof wizard.selectGeneratedAndComplete>) => {
      wizard.selectGeneratedAndComplete(...args);
    },
    [wizard]
  );

  // Step 3 (results) uses wider layout for the 4-column card grid
  const isResultsStep = wizard.currentStep === 3;
  const containerClass = isResultsStep
    ? 'mx-auto max-w-[1080px] px-6 py-10'
    : 'mx-auto max-w-[720px] px-6 py-10';

  if (dailyReached) {
    return (
      <div className="mx-auto max-w-[720px] px-6 py-10">
        <div className="mb-10 text-[10px] font-bold uppercase tracking-[2px] text-foreground/[0.08]">
          /mandalas/new
        </div>
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-10 text-center">
          <Ban className="mx-auto mb-4 h-10 w-10 text-destructive/70" strokeWidth={1.6} />
          <h1 className="mb-2 text-[22px] font-bold tracking-tight">
            {t('wizard.dailyLimitReached.title', 'Daily limit reached')}
          </h1>
          <p className="mx-auto mb-6 max-w-[420px] text-[14px] leading-relaxed text-muted-foreground">
            {t(
              'wizard.dailyLimitReached.description',
              'You have created {{used}} mandalas today (daily limit: {{limit}}). You can create more tomorrow.',
              { used: quota?.daily?.used ?? 0, limit: quota?.daily?.limit ?? 5 }
            )}
          </p>
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-4 py-2 text-[13px] font-semibold text-foreground transition-colors hover:bg-foreground/[0.04]"
          >
            {t('wizard.quotaReached.backHome', 'Back to home')}
          </Link>
        </div>
      </div>
    );
  }

  if (quotaReached) {
    return (
      <div className="mx-auto max-w-[720px] px-6 py-10">
        <div className="mb-10 text-[10px] font-bold uppercase tracking-[2px] text-foreground/[0.08]">
          /mandalas/new
        </div>
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-10 text-center">
          <Ban className="mx-auto mb-4 h-10 w-10 text-destructive/70" strokeWidth={1.6} />
          <h1 className="mb-2 text-[22px] font-bold tracking-tight">
            {t('wizard.quotaReached.title', 'Mandala limit reached')}
          </h1>
          <p className="mx-auto mb-6 max-w-[420px] text-[14px] leading-relaxed text-muted-foreground">
            {t(
              'wizard.quotaReached.description',
              'You have reached the mandala limit for your plan ({{used}} / {{limit}}). Delete an existing mandala or upgrade to create more.',
              { used: quota?.used ?? 0, limit: quota?.limit ?? 0 }
            )}
          </p>
          <div className="flex items-center justify-center gap-3">
            <Link
              to="/"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-4 py-2 text-[13px] font-semibold text-foreground transition-colors hover:bg-foreground/[0.04]"
            >
              {t('wizard.quotaReached.backHome', 'Back to home')}
            </Link>
            <Link
              to="/settings/subscription"
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              {t('wizard.quotaReached.upgrade', 'Upgrade plan')}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={containerClass}>
      <Link
        to="/"
        className="mb-6 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        {t('settings.backToApp', 'Back to app')}
      </Link>

      <WizardStepper currentStep={wizard.currentStep} />

      {/* Step 1: Goal input only — no search/generate yet */}
      {wizard.currentStep === 1 && (
        <WizardStepGoal
          goalInput={wizard.goalInput}
          searchResults={[]}
          isSearching={false}
          searchSucceeded={false}
          isSearchSoftSlow={false}
          isSearchFailed={false}
          onRetrySearch={() => {}}
          aiGenerated={null}
          aiSource={null}
          isGenerating={false}
          isGenerateSoftSlow={false}
          isGenerateFailed={false}
          onRetryGenerate={() => {}}
          generateError={null}
          onSetGoalInput={wizard.setGoalInput}
          onSubmitGoal={handleGoalGo}
          onCancelGoal={wizard.cancelGoal}
          onClearGoal={wizard.clearGoal}
          onSelectSearchResult={() => {}}
          onSelectGeneratedMandala={() => {}}
          onCreateBlank={wizard.createBlank}
          isCreatingBlank={wizard.isCreatingBlank}
        />
      )}

      {/* Step 2: Context (focus tags + target level) */}
      {wizard.currentStep === 2 && (
        <WizardStepContext
          focusTags={wizard.focusTags}
          targetLevel={wizard.targetLevel}
          onSetFocusTags={wizard.setFocusTags}
          onSetTargetLevel={wizard.setTargetLevel}
          onComplete={handleContextContinue}
          onBack={() => wizard.goToStep(1)}
          isCreating={false}
        />
      )}

      {/* Step 3: Results — search + generate fired, show results */}
      {wizard.currentStep === 3 && (
        <WizardStepGoal
          goalInput={wizard.goalInput}
          searchResults={wizard.searchResults}
          isSearching={wizard.isSearching}
          searchSucceeded={wizard.searchSucceeded}
          isSearchSoftSlow={wizard.isSearchSoftSlow}
          isSearchFailed={wizard.isSearchFailed}
          onRetrySearch={wizard.retrySearch}
          aiGenerated={wizard.aiGenerated}
          aiSource={wizard.aiSource}
          isGenerating={wizard.isGenerating}
          isGenerateSoftSlow={wizard.isGenerateSoftSlow}
          isGenerateFailed={wizard.isGenerateFailed}
          onRetryGenerate={wizard.retryGenerate}
          generateError={wizard.generateError as Error | null}
          onSetGoalInput={wizard.setGoalInput}
          onSubmitGoal={wizard.submitGoal}
          onCancelGoal={wizard.cancelGoal}
          onClearGoal={wizard.clearGoal}
          onSelectSearchResult={handleSelectAndComplete}
          onSelectGeneratedMandala={handleSelectGeneratedAndComplete}
          onCreateBlank={wizard.createBlank}
          isCreatingBlank={wizard.isCreatingBlank}
        />
      )}

      {wizard.createError && (
        <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-center text-sm text-destructive">
          {wizard.createError.message}
        </div>
      )}
    </div>
  );
}
