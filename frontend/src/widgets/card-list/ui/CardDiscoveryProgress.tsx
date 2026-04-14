import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import { apiClient } from '@/shared/lib/api-client';

const TOTAL_STEPS = 8;
const STEP_DURATION_MS = 3_000;
const TIMEOUT_MS = 90_000;

interface CardDiscoveryProgressProps {
  mandalaId: string;
  isComplete?: boolean;
  onTimeout?: () => void;
}

export function CardDiscoveryProgress({
  mandalaId,
  isComplete = false,
  onTimeout,
}: CardDiscoveryProgressProps) {
  const { t } = useTranslation();
  const [currentStep, setCurrentStep] = useState(1);
  const [isFailed, setIsFailed] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);

  // Step progression timer
  useEffect(() => {
    if (isComplete) {
      setCurrentStep(TOTAL_STEPS);
      return;
    }
    if (isFailed || currentStep >= TOTAL_STEPS) return;
    const timer = setTimeout(() => {
      setCurrentStep((prev) => Math.min(prev + 1, TOTAL_STEPS));
    }, STEP_DURATION_MS);
    return () => clearTimeout(timer);
  }, [currentStep, isComplete, isFailed]);

  // Timeout → check pipeline status
  useEffect(() => {
    if (isComplete || isFailed) return;
    const timer = setTimeout(async () => {
      try {
        const res = await apiClient.getPipelineStatus(mandalaId);
        if (res.cardCount === 0 && res.status !== 'completed') {
          setIsFailed(true);
        }
      } catch {
        setIsFailed(true);
      }
      onTimeout?.();
    }, TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [mandalaId, isComplete, isFailed, onTimeout]);

  const handleRetry = useCallback(async () => {
    setIsRetrying(true);
    try {
      await apiClient.triggerPipeline(mandalaId);
      setIsFailed(false);
      setCurrentStep(1);
    } catch {
      // Retry failed — keep showing error
    } finally {
      setIsRetrying(false);
    }
  }, [mandalaId]);

  // Failed state — show retry UI
  if (isFailed) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3">
        <span className="text-sm text-amber-400">
          {t('discovery.failed', "Video recommendations couldn't be loaded.")}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRetry}
          disabled={isRetrying}
          className="shrink-0 gap-1.5 border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isRetrying ? 'animate-spin' : ''}`} />
          {t('discovery.retry', 'Retry')}
        </Button>
      </div>
    );
  }

  const stepKey = `discovery.step${currentStep}` as const;

  return (
    <div className="flex items-center gap-2.5 px-1 py-2">
      <span
        className="inline-block h-2 w-2 shrink-0 rounded-full bg-emerald-500"
        style={{ animation: 'insighta-breathe 1.5s ease-in-out infinite' }}
      />
      <p
        key={currentStep}
        className="insighta-shimmer-text text-sm"
        style={{ animation: 'insighta-fade-in 400ms ease-out' }}
      >
        {t(stepKey)}
      </p>
    </div>
  );
}
