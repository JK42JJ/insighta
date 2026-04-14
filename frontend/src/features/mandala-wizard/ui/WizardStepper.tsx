import { useTranslation } from 'react-i18next';

interface WizardStepperProps {
  currentStep: 1 | 2;
}

export default function WizardStepper({ currentStep }: WizardStepperProps) {
  const { t } = useTranslation();

  const STEP_LABELS = [t('wizard.steps.domain'), t('wizard.steps.context', 'Context')] as const;

  return (
    <div
      className="mb-12 flex items-center"
      role="navigation"
      aria-label={t('wizard.navigation.aria')}
    >
      {[1, 2].map((step, idx) => (
        <div key={step} className="contents">
          {idx > 0 && (
            <div
              className={`h-px flex-1 transition-colors duration-300 ${
                step <= currentStep ? 'bg-primary/30' : 'bg-border'
              }`}
            />
          )}
          <div
            className={`grid h-7 w-7 flex-shrink-0 place-items-center rounded-full text-[11px] font-bold transition-all duration-300 ${
              step < currentStep
                ? 'bg-emerald-500/15 text-emerald-400'
                : step === currentStep
                  ? 'bg-primary text-primary-foreground shadow-[0_0_20px_hsl(var(--primary)/0.35)]'
                  : 'border border-border bg-muted text-muted-foreground/20'
            }`}
            aria-current={step === currentStep ? 'step' : undefined}
            aria-label={`${STEP_LABELS[idx]} (${
              step < currentStep
                ? t('wizard.stepStatus.completed')
                : step === currentStep
                  ? t('wizard.stepStatus.current')
                  : t('wizard.stepStatus.waiting')
            })`}
          >
            {step}
          </div>
        </div>
      ))}
    </div>
  );
}
