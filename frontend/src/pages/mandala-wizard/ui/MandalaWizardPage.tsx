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
  // Bug #4 fix: gate the entire wizard on mandala quota at MOUNT time.
  // Previously the quota error surfaced at Step 3 "시작하기" click — users
  // completed goal entry + template preview + skill selection only to be
  // blocked at the end with "Mandala limit reached (3/3)". Check here so
  // the user sees the block immediately and is directed to the upgrade
  // path before investing any effort.
  const { data: quota, isLoading: quotaLoading } = useMandalaQuota();
  const quotaReached =
    !quotaLoading && quota?.limit !== null && quota?.limit !== undefined && quota.remaining === 0;

  // Step 1 (Goal) uses wider layout for the 4-column card grid
  const isGoalStep = wizard.currentStep === 1;
  const containerClass = isGoalStep
    ? 'mx-auto max-w-[1080px] px-6 py-10'
    : 'mx-auto max-w-[720px] px-6 py-10';

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

      {wizard.currentStep === 1 && (
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
          onSelectSearchResult={wizard.selectSearchResult}
          onSelectGeneratedMandala={wizard.selectGeneratedMandala}
          onCreateBlank={wizard.createBlank}
        />
      )}

      {wizard.currentStep === 2 && wizard.selectedTemplate && (
        <WizardStepContext
          focusTags={wizard.focusTags}
          targetLevel={wizard.targetLevel}
          onSetFocusTags={wizard.setFocusTags}
          onSetTargetLevel={wizard.setTargetLevel}
          onComplete={wizard.complete}
          onBack={() => wizard.goToStep(1)}
          isCreating={wizard.isCreating}
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
