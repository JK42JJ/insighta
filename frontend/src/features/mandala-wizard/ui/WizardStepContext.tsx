import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Loader2 } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import { cn } from '@/shared/lib/utils';

const TARGET_LEVELS = ['foundation', 'standard', 'advanced'] as const;
type TargetLevel = (typeof TARGET_LEVELS)[number];

interface WizardStepContextProps {
  focusTags: string[];
  targetLevel: string;
  onSetFocusTags: (tags: string[]) => void;
  onSetTargetLevel: (level: string) => void;
  onComplete: () => void;
  onBack: () => void;
  isCreating: boolean;
}

export default function WizardStepContext({
  focusTags,
  targetLevel,
  onSetFocusTags,
  onSetTargetLevel,
  onComplete,
  onBack,
  isCreating,
}: WizardStepContextProps) {
  const { t } = useTranslation();
  const [tagInput, setTagInput] = useState('');

  const addTag = useCallback(() => {
    const trimmed = tagInput.trim();
    if (!trimmed || focusTags.includes(trimmed)) return;
    onSetFocusTags([...focusTags, trimmed]);
    setTagInput('');
  }, [tagInput, focusTags, onSetFocusTags]);

  const removeTag = useCallback(
    (tag: string) => {
      onSetFocusTags(focusTags.filter((t) => t !== tag));
    },
    [focusTags, onSetFocusTags]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addTag();
      }
    },
    [addTag]
  );

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="text-center">
        <h2 className="text-xl font-bold tracking-tight">
          {t('wizard.context.title', "Anything else you'd like to focus on?")}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {t(
            'wizard.context.subtitle',
            'Add focus areas and select your target level. You can skip this step.'
          )}
        </p>
      </div>

      {/* Focus Tags */}
      <div className="space-y-3">
        <label className="text-sm font-semibold text-foreground/80">
          {t('wizard.context.focusLabel', 'Focus areas')}
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('wizard.context.focusPlaceholder', 'e.g. ETF, budgeting, real estate')}
            className="flex-1 rounded-lg border border-border bg-surface-light px-3 py-2 text-sm outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
            maxLength={30}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={addTag}
            disabled={!tagInput.trim()}
            className="shrink-0"
          >
            {t('wizard.context.addTag', 'Add')}
          </Button>
        </div>
        {focusTags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {focusTags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary"
              >
                {tag}
                <button
                  onClick={() => removeTag(tag)}
                  className="rounded-full p-0.5 hover:bg-primary/20 transition-colors"
                  aria-label={`Remove ${tag}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Target Level */}
      <div className="space-y-3">
        <label className="text-sm font-semibold text-foreground/80">
          {t('wizard.context.levelLabel', 'Target level')}
        </label>
        <div className="flex gap-2">
          {TARGET_LEVELS.map((level) => (
            <button
              key={level}
              onClick={() => onSetTargetLevel(level)}
              className={cn(
                'flex-1 rounded-lg border px-4 py-2.5 text-sm font-medium transition-all',
                targetLevel === level
                  ? 'border-primary bg-primary/10 text-primary shadow-sm'
                  : 'border-border bg-surface-light text-muted-foreground hover:border-primary/30 hover:text-foreground'
              )}
            >
              {t(`wizard.context.level.${level}`, level.charAt(0).toUpperCase() + level.slice(1))}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {targetLevel === 'foundation' &&
            t('wizard.context.levelDesc.foundation', 'Step-by-step basics for beginners')}
          {targetLevel === 'standard' &&
            t('wizard.context.levelDesc.standard', 'Practical skills for everyday use')}
          {targetLevel === 'advanced' &&
            t('wizard.context.levelDesc.advanced', 'Deep mastery and expert techniques')}
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between pt-4">
        <Button variant="ghost" onClick={onBack} className="text-muted-foreground">
          {t('common.back', 'Back')}
        </Button>
        <Button onClick={onComplete} disabled={isCreating}>
          {isCreating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {t('wizard.context.continue', 'Continue')}
        </Button>
      </div>
    </div>
  );
}
