import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/utils';
import { MANDALA_DOMAINS, type MandalaDomain } from '@/shared/config/domain-colors';

interface DomainChipsProps {
  selected: MandalaDomain | 'all';
  onSelect: (domain: MandalaDomain | 'all') => void;
}

const ALL_OPTIONS = ['all', ...MANDALA_DOMAINS] as const;

export function DomainChips({ selected, onSelect }: DomainChipsProps) {
  const { t } = useTranslation();

  return (
    <div className="flex gap-1.5 justify-center flex-wrap mb-7">
      {ALL_OPTIONS.map((domain) => (
        <button
          key={domain}
          onClick={() => onSelect(domain)}
          className={cn(
            'px-3.5 py-1.5 rounded-full text-xs font-medium transition-all duration-200',
            selected === domain
              ? 'bg-primary/10 border border-primary/25 text-primary'
              : 'bg-transparent border border-border/30 text-muted-foreground/50 hover:border-border hover:text-muted-foreground'
          )}
        >
          {t(`explore.domain.${domain}`)}
        </button>
      ))}
    </div>
  );
}
