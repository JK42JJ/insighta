import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Ban } from 'lucide-react';
import {
  useWizard,
  WizardStepper,
  WizardStepGoal,
  WizardStepContext,
} from '@/features/mandala-wizard';
import { useMandalaQuota } from '@/features/mandala';

export default function MandalaWizardPage() {
  const { t } = useTranslation();
  const wizard = useWizard();
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

  const handleSelectGeneratedAndComplete = useCallback(
    (...args: Parameters<typeof wizard.selectGeneratedMandala>) => {
      wizard.selectGeneratedMandala(...args);
      setTimeout(() => wizard.complete(), 0);
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
      <div className="mb-10 text-[10px] font-bold uppercase tracking-[2px] text-foreground/[0.08]">
        /mandalas/new
      </div>

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
