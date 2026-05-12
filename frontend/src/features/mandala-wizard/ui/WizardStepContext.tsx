import { useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Loader2 } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import { cn } from '@/shared/lib/utils';

const TARGET_LEVELS = ['foundation', 'standard', 'advanced'] as const;

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
  const isComposingRef = useRef(false);

  const addTag = useCallback(() => {
    const trimmed = tagInput.trim();
    if (!trimmed || focusTags.includes(trimmed)) return;
    onSetFocusTags([...focusTags, trimmed]);
    setTagInput('');
  }, [tagInput, focusTags, onSetFocusTags]);

  const removeTag = useCallback(
    (tag: string) => {
      onSetFocusTags(focusTags.filter((tg) => tg !== tag));
    },
    [focusTags, onSetFocusTags]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !isComposingRef.current) {
        e.preventDefault();
        addTag();
      }
    },
    [addTag]
  );

  return (
    <div className="space-y-9 wizard-step-enter">
      <div className="text-center">
        <h1
          className="text-[36px] font-bold leading-[1.2]"
          style={{ color: 'hsl(var(--foreground))', letterSpacing: '-0.03em' }}
        >
          {t('wizard.context.title', "Anything else you'd like to focus on?")}
        </h1>
        <p className="mt-3 text-[14px] leading-relaxed text-muted-foreground/80">
          {t(
            'wizard.context.subtitle',
            'Add focus areas to find more relevant videos. You can skip.'
          )}
        </p>
      </div>

      <div className="mx-auto w-full max-w-[720px] space-y-4">
        <div
          className="flex flex-wrap items-center gap-2 rounded-2xl px-3 py-2 transition-colors focus-within:border-primary/50"
          style={{
            background: 'hsl(var(--input))',
            border: '1px solid hsl(var(--border) / 0.2)',
            minHeight: '52px',
          }}
        >
          {focusTags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-semibold"
              style={{
                background: 'hsl(var(--primary) / 0.12)',
                color: 'hsl(var(--primary))',
              }}
            >
              {tag}
              <button
                type="button"
                onClick={() => removeTag(tag)}
                className="grid h-3.5 w-3.5 place-items-center rounded-sm transition-colors hover:bg-primary/20"
                aria-label={`Remove ${tag}`}
              >
                <X className="h-3 w-3" strokeWidth={2.5} />
              </button>
            </span>
          ))}
          <input
            type="text"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onCompositionStart={() => {
              isComposingRef.current = true;
            }}
            onCompositionEnd={() => {
              isComposingRef.current = false;
            }}
            placeholder={t(
              'wizard.context.focusPlaceholder',
              'Add a focus area — e.g. hybrid search, BGE-M3, reranker'
            )}
            className="min-w-[140px] flex-1 border-none bg-transparent px-1 py-1.5 text-[14px] outline-none placeholder:text-muted-foreground/45 focus-visible:ring-0 focus-visible:ring-offset-0"
            maxLength={30}
          />
        </div>

        <div className="flex justify-center">
          <div
            className="inline-flex gap-0.5 rounded-lg p-[3px]"
            style={{
              background: 'hsl(var(--input))',
              border: '1px solid hsl(var(--border) / 0.2)',
            }}
          >
            {TARGET_LEVELS.map((level) => {
              const isSelected = targetLevel === level;
              return (
                <button
                  key={level}
                  type="button"
                  onClick={() => onSetTargetLevel(level)}
                  className={cn(
                    'rounded-md px-4 py-1.5 text-[13px] font-medium transition-all',
                    isSelected
                      ? 'bg-background text-foreground shadow-sm font-semibold'
                      : 'text-muted-foreground/70 hover:text-foreground'
                  )}
                >
                  {t(`wizard.context.level.${level}`, level)}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-[720px] items-center justify-between pt-2">
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
