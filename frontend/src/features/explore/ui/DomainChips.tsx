import { useTranslation } from 'react-i18next';
import {
  Grid3x3,
  Code2,
  GraduationCap,
  HeartPulse,
  Briefcase,
  TrendingUp,
  Users,
  Palette,
  Coffee,
  Brain,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { MANDALA_DOMAINS, DOMAIN_STYLES, type MandalaDomain } from '@/shared/config/domain-colors';

interface DomainChipsProps {
  selected: MandalaDomain | 'all';
  onSelect: (domain: MandalaDomain | 'all') => void;
}

const ALL_OPTIONS = ['all', ...MANDALA_DOMAINS] as const;

// Icon per domain. 'all' uses a neutral grid glyph; other domains use a
// semantically-aligned icon and pick up their hex color from DOMAIN_STYLES
// on hover (group-hover via CSS variable).
const DOMAIN_ICONS: Record<MandalaDomain | 'all', LucideIcon> = {
  all: Grid3x3,
  tech: Code2,
  learning: GraduationCap,
  health: HeartPulse,
  business: Briefcase,
  finance: TrendingUp,
  social: Users,
  creative: Palette,
  lifestyle: Coffee,
  mind: Brain,
};

export function DomainChips({ selected, onSelect }: DomainChipsProps) {
  const { t } = useTranslation();

  return (
    <div className="flex gap-1.5 justify-center flex-wrap mb-[84px]">
      {ALL_OPTIONS.map((domain) => {
        const Icon = DOMAIN_ICONS[domain];
        const hoverColor =
          domain === 'all' ? 'hsl(var(--foreground))' : DOMAIN_STYLES[domain].color;
        return (
          <button
            key={domain}
            onClick={() => onSelect(domain)}
            style={{ ['--chip-hover-color' as string]: hoverColor }}
            className={cn(
              'group inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium transition-all duration-200',
              selected === domain
                ? 'bg-primary/10 border border-primary/25 text-primary'
                : 'bg-transparent border border-border/30 text-muted-foreground/50 hover:border-border hover:text-muted-foreground'
            )}
          >
            <Icon
              className="h-3.5 w-3.5 transition-colors group-hover:[color:var(--chip-hover-color)]"
              strokeWidth={1.8}
              aria-hidden="true"
            />
            {t(`explore.domain.${domain}`)}
          </button>
        );
      })}
    </div>
  );
}
