/**
 * Target level (난이도) chip group (CP466 amendment 2).
 *
 * Editable wizard meta — single-select radio. Default 'standard'
 * (no-op for BE keyword expansion). Per user directive 2026-05-18:
 * "기 입력한 키워드와 난이도는 수정 가능".
 *
 * Spec: docs/design/add-cards-2026-05-18.md §6 (FE widget).
 */

import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/utils';
import { useAddCardsPanelStore } from '../model/useAddCardsPanelStore';

// CP466 amendment 2 fix — wizard exposes 3 target levels (foundation /
// standard / advanced) per `frontend/src/features/mandala-wizard/ui/
// WizardStepContext.tsx:6 TARGET_LEVELS`. Labels mirror the wizard's
// own i18n keys (`wizard.context.level.*`) so the chip text matches
// what the user selected during mandala creation.
const LEVEL_PRESETS = [
  {
    value: 'foundation',
    labelKey: 'addCards.targetLevel.foundation',
    defaultLabel: 'Foundation',
  },
  {
    value: 'standard',
    labelKey: 'addCards.targetLevel.standard',
    defaultLabel: 'Standard',
  },
  {
    value: 'advanced',
    labelKey: 'addCards.targetLevel.advanced',
    defaultLabel: 'Advanced',
  },
] as const;

export function TargetLevelChips() {
  const { t } = useTranslation();
  const targetLevel = useAddCardsPanelStore((s) => s.targetLevel);
  const setTargetLevel = useAddCardsPanelStore((s) => s.setTargetLevel);

  return (
    <div className="flex items-center gap-2 px-5 py-1.5 sm:px-6">
      <span className="shrink-0 text-[10.5px] uppercase tracking-wider text-muted-foreground w-[68px]">
        {t('addCards.targetLevel.label', 'Level')}
      </span>
      <div className="flex-1 flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {LEVEL_PRESETS.map((p) => {
          const isActive = targetLevel === p.value;
          return (
            <button
              key={p.value}
              type="button"
              onClick={() => setTargetLevel(p.value)}
              aria-pressed={isActive}
              className={cn(
                'shrink-0 inline-flex items-center h-7 rounded-full border px-3 text-[11.5px] font-medium transition-colors',
                isActive
                  ? 'bg-foreground text-background border-foreground'
                  : 'bg-transparent text-foreground/80 border-border/50 hover:border-border hover:bg-foreground/[0.04]'
              )}
            >
              {t(p.labelKey, p.defaultLabel)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
