import { useTranslation } from 'react-i18next';
import {
  Code2,
  Heart,
  Briefcase,
  DollarSign,
  Palette,
  Smile,
  ChevronRight,
  Loader2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import type { WizardTemplate, WizardDomain } from '@/shared/types/mandala-ux';

// ─── Domain data ───

const ICON_MAP: Record<string, LucideIcon> = {
  Code2,
  Heart,
  Briefcase,
  DollarSign,
  Palette,
  Smile,
};

const DOMAIN_IDS = ['tech', 'health', 'business', 'finance', 'creative', 'lifestyle'] as const;
const DOMAIN_ICONS: Record<string, string> = {
  tech: 'Code2',
  health: 'Heart',
  business: 'Briefcase',
  finance: 'DollarSign',
  creative: 'Palette',
  lifestyle: 'Smile',
};

// ─── Component ───

interface WizardStepDomainProps {
  selectedDomain: string | null;
  templates: WizardTemplate[];
  isLoadingTemplates: boolean;
  onSelectDomain: (domainId: string) => void;
  onSelectTemplate: (template: WizardTemplate) => void;
  onCreateBlank: () => void;
}

export default function WizardStepDomain({
  selectedDomain,
  templates,
  isLoadingTemplates,
  onSelectDomain,
  onSelectTemplate,
  onCreateBlank,
}: WizardStepDomainProps) {
  const { t } = useTranslation();

  const WIZARD_DOMAINS: WizardDomain[] = DOMAIN_IDS.map((id) => ({
    id,
    name: t(`wizard.domain.categories.${id}`),
    icon: DOMAIN_ICONS[id],
  }));

  return (
    <div className="wizard-step-enter">
      <h1 className="text-[28px] font-black leading-tight tracking-tight">
        {t('wizard.domain.title')}
      </h1>
      <p className="mt-1.5 text-[14.5px] leading-relaxed text-muted-foreground">
        {t('wizard.domain.subtitle')}
      </p>

      {/* Domain grid */}
      <div className="mt-8 grid grid-cols-3 gap-2.5">
        {WIZARD_DOMAINS.map((domain) => {
          const Icon = ICON_MAP[domain.icon];
          const isSelected = selectedDomain === domain.id;

          return (
            <button
              key={domain.id}
              type="button"
              onClick={() => onSelectDomain(domain.id)}
              className={`group relative overflow-hidden rounded-2xl border px-4 pb-5 pt-7 text-center transition-all duration-300 ${
                isSelected
                  ? 'border-primary/30 bg-primary/[0.03]'
                  : 'border-border bg-card hover:-translate-y-[3px] hover:border-primary/[0.14] hover:shadow-[0_10px_30px_rgba(0,0,0,0.2)]'
              }`}
              aria-pressed={isSelected}
            >
              {/* Radial glow overlay */}
              <div
                className={`pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,hsl(var(--primary)/0.06),transparent_60%)] transition-opacity duration-300 ${
                  isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                }`}
              />
              {Icon && (
                <Icon
                  className={`mx-auto mb-3 h-[26px] w-[26px] transition-opacity duration-200 ${
                    isSelected ? 'opacity-90 text-primary' : 'opacity-40 text-primary'
                  }`}
                  strokeWidth={1.8}
                  aria-hidden="true"
                />
              )}
              <span
                className={`text-[13.5px] font-semibold transition-colors duration-200 ${
                  isSelected ? 'text-primary' : 'text-muted-foreground'
                }`}
              >
                {domain.name}
              </span>
            </button>
          );
        })}
      </div>

      {/* Template panel (slides up when domain selected) */}
      {selectedDomain && (
        <div className="wizard-slide-up mt-6">
          <div className="mb-3 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
            {WIZARD_DOMAINS.find((d) => d.id === selectedDomain)?.name}{' '}
            {t('wizard.domain.templates.title')}
          </div>

          {isLoadingTemplates ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : templates.length === 0 ? (
            <div className="rounded-xl border border-border bg-card px-4 py-8 text-center text-xs text-muted-foreground">
              {t('wizard.domain.templates.comingSoon')}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {templates.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => onSelectTemplate(tpl)}
                  className="group flex items-center gap-4 rounded-[14px] border border-border bg-card px-5 py-[18px] text-left transition-all duration-[250ms] hover:translate-x-1 hover:border-primary/[0.14] hover:bg-primary/[0.02]"
                >
                  <div className="min-w-0 flex-1">
                    <h4 className="text-[14.5px] font-bold">{tpl.title}</h4>
                    <small className="mt-0.5 block text-[11.5px] text-muted-foreground">
                      {tpl.likeCount > 0 ? `\u2665 ${tpl.likeCount}` : ''}
                    </small>
                  </div>
                  <ChevronRight className="h-[18px] w-[18px] flex-shrink-0 text-muted-foreground transition-all duration-200 group-hover:translate-x-[3px] group-hover:text-primary" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Separator + blank create */}
      <div className="my-8 text-center text-[11px] font-semibold text-foreground/[0.06]">
        {t('wizard.domain.separator')}
      </div>
      <div className="text-center">
        <button
          type="button"
          onClick={onCreateBlank}
          className="inline-flex items-center gap-1.5 rounded-[10px] border border-border bg-transparent px-5 py-2.5 text-[13px] font-semibold text-muted-foreground transition-all duration-[180ms] hover:border-foreground/10 hover:bg-foreground/[0.02] hover:text-foreground"
        >
          {t('wizard.domain.createBlank')} &rarr;
        </button>
      </div>
    </div>
  );
}
