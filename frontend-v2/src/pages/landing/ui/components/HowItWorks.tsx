import { useTranslation } from 'react-i18next';
import { Grid3X3, GripVertical, Lightbulb } from 'lucide-react';
import { useScrollReveal } from '@/shared/hooks/useScrollReveal';

const STEPS = [
  { icon: Grid3X3, stepKey: 'step1' },
  { icon: GripVertical, stepKey: 'step2' },
  { icon: Lightbulb, stepKey: 'step3' },
] as const;

export function HowItWorks() {
  const { t } = useTranslation();
  const sectionRef = useScrollReveal();

  return (
    <section className="py-20 md:py-28 bg-muted dark:bg-[hsl(var(--bg-mid))]">
      <div className="mx-auto max-w-5xl px-4" ref={sectionRef}>
        <div className="text-center mb-14">
          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-primary/10 text-primary mb-4">
            {t('landing.howItWorksLabel')}
          </span>
          <h2 className="text-3xl md:text-4xl font-semibold tracking-tight">
            {t('landing.howItWorksTitle')}
          </h2>
        </div>

        {/* Desktop: 5-col grid with connectors */}
        <div className="hidden md:grid md:grid-cols-[1fr_auto_1fr_auto_1fr] md:gap-4 md:items-start">
          {STEPS.map(({ icon: Icon, stepKey }, i) => (
            <div key={stepKey} className="contents">
              <div className={`reveal reveal-delay-${i + 1} flex flex-col items-center text-center gap-4`}>
                <div className="relative">
                  <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center shadow-md">
                    <Icon className="w-7 h-7 text-primary" />
                  </div>
                  <span className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-primary text-primary-foreground text-sm font-bold flex items-center justify-center shadow-sm">
                    {i + 1}
                  </span>
                </div>
                <h3 className="text-lg font-semibold">
                  {t(`landing.${stepKey}Title`)}
                </h3>
                <p className="text-muted-foreground text-sm leading-relaxed max-w-xs">
                  {t(`landing.${stepKey}Desc`)}
                </p>
              </div>
              {i < 2 && (
                <div className="flex items-center h-16 mt-0">
                  <div className="w-12 border-t-2 border-dashed border-primary/25" />
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Mobile: stacked */}
        <div className="grid grid-cols-1 gap-8 md:hidden">
          {STEPS.map(({ icon: Icon, stepKey }, i) => (
            <div key={stepKey} className={`reveal reveal-delay-${i + 1} flex flex-col items-center text-center gap-4`}>
              <div className="relative">
                <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center shadow-md">
                  <Icon className="w-7 h-7 text-primary" />
                </div>
                <span className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-primary text-primary-foreground text-sm font-bold flex items-center justify-center shadow-sm">
                  {i + 1}
                </span>
              </div>
              <h3 className="text-lg font-semibold">
                {t(`landing.${stepKey}Title`)}
              </h3>
              <p className="text-muted-foreground text-sm leading-relaxed max-w-xs">
                {t(`landing.${stepKey}Desc`)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
