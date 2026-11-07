import { MORNING_CARD_DOMAIN_KEYS, type MorningCardDomainKey } from '@/features/morning-cards/api';

export const MORNING_CARD_DOMAIN_LABELS: Record<MorningCardDomainKey, string> = {
  work_practice: '업무 실무',
  startup_gov_support: '창업·정부 지원',
  ai_tools: 'AI 도구',
};

interface DomainPickerProps {
  value: MorningCardDomainKey;
  onChange: (key: MorningCardDomainKey) => void;
}

/** Three-option domain picker for the morning cards screen. */
export function DomainPicker({ value, onChange }: DomainPickerProps) {
  return (
    <div role="tablist" aria-label="도메인" className="flex w-full gap-2">
      {MORNING_CARD_DOMAIN_KEYS.map((key) => {
        const selected = key === value;
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(key)}
            className={
              selected
                ? 'flex-1 rounded-md border border-primary bg-primary px-2 py-2 text-sm text-primary-foreground'
                : 'flex-1 rounded-md border border-border bg-card px-2 py-2 text-sm text-card-foreground'
            }
          >
            {MORNING_CARD_DOMAIN_LABELS[key]}
          </button>
        );
      })}
    </div>
  );
}
