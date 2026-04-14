import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

const TOTAL_STEPS = 8;
const STEP_DURATION_MS = 3_000;

interface CardDiscoveryProgressProps {
  isComplete?: boolean;
}

export function CardDiscoveryProgress({ isComplete = false }: CardDiscoveryProgressProps) {
  const { t } = useTranslation();
  const [currentStep, setCurrentStep] = useState(1);

  useEffect(() => {
    if (isComplete) setCurrentStep(TOTAL_STEPS);
  }, [isComplete]);

  useEffect(() => {
    if (isComplete || currentStep >= TOTAL_STEPS) return;
    const timer = setTimeout(() => {
      setCurrentStep((prev) => Math.min(prev + 1, TOTAL_STEPS));
    }, STEP_DURATION_MS);
    return () => clearTimeout(timer);
  }, [currentStep, isComplete]);

  const stepKey = `discovery.step${currentStep}` as const;

  return (
    <div className="flex items-center gap-2.5 px-1 py-2">
      <span
        className="inline-block h-2 w-2 shrink-0 rounded-full bg-emerald-500"
        style={{ animation: 'insighta-breathe 1.5s ease-in-out infinite' }}
      />
      <span className="insighta-shimmer-text text-sm">{t(stepKey)}</span>
    </div>
  );
}
