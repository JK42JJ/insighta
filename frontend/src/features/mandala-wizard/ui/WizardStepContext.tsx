import { useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Loader2, ArrowRight, Lock } from 'lucide-react';
import { cn } from '@/shared/lib/utils';

const TARGET_LEVELS = ['foundation', 'standard', 'advanced'] as const;

interface WizardStepContextProps {
  /** Step-1 goal text — shown locked at the top of the focus-input bar so the
   *  user retains context while adding focus tags. */
  goal?: string;
  focusTags: string[];
  targetLevel: string;
  onSetFocusTags: (tags: string[]) => void;
  onSetTargetLevel: (level: string) => void;
  onComplete: () => void;
  onBack: () => void;
  isCreating: boolean;
}

export default function WizardStepContext({
  goal,
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
          className="rounded-[28px] px-5 py-3 transition-colors focus-within:border-primary/50"
          style={{
            background: 'hsl(var(--input))',
            border: '1px solid hsl(var(--border) / 0.15)',
          }}
        >
          {goal && (
            <div className="flex items-center gap-2.5 pb-2.5">
              <Lock
                className="h-[14px] w-[14px] flex-shrink-0"
                style={{ color: 'hsl(var(--muted-foreground) / 0.6)' }}
                strokeWidth={2}
                aria-hidden="true"
              />
              <span
                className="truncate text-[14px] font-medium"
                style={{ color: 'hsl(var(--foreground) / 0.8)' }}
                title={goal}
              >
                {goal}
              </span>
            </div>
          )}
          <div
            className={cn('flex flex-wrap items-center gap-2', goal ? 'pt-2.5' : '')}
            style={{ minHeight: '36px' }}
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
        </div>

        <div className="flex justify-center">
          <div
            className="inline-flex gap-0.5 rounded-full p-[3px]"
            style={{
              background: 'hsl(var(--input))',
              border: '1px solid hsl(var(--border) / 0.15)',
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
                    'rounded-full px-4 py-1.5 text-[13px] font-medium transition-all',
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
        <button
          type="button"
          onClick={onBack}
          className="inline-flex h-10 items-center rounded-full px-4 text-[13px] font-medium text-muted-foreground transition hover:bg-foreground/[0.04] hover:text-foreground"
        >
          {t('common.back', 'Back')}
        </button>
        <button
          type="button"
          onClick={onComplete}
          disabled={isCreating}
          className="inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          style={{
            background: 'hsl(var(--primary))',
            color: 'hsl(var(--primary-foreground))',
          }}
        >
          {isCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {t('wizard.context.continue', 'Continue')}
          {!isCreating && <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.5} />}
        </button>
      </div>
    </div>
  );
}
