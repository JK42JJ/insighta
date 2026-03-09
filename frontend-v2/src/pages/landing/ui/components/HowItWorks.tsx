import { useTranslation } from 'react-i18next';
import { Grid3X3, GripVertical, Lightbulb } from 'lucide-react';

const STEPS = [
  { icon: Grid3X3, stepKey: 'step1' },
  { icon: GripVertical, stepKey: 'step2' },
  { icon: Lightbulb, stepKey: 'step3' },
] as const;

export function HowItWorks() {
  const { t } = useTranslation();

  return (
    <section className="py-20 md:py-28 bg-[#F4F6F7] dark:bg-[hsl(225,35%,10%)]">
      <div className="mx-auto max-w-5xl px-4">
        <div className="text-center mb-14">
          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-primary/10 text-primary mb-4">
            {t('landing.howItWorksLabel')}
          </span>
          <h2 className="text-3xl md:text-4xl font-semibold tracking-tight">
            {t('landing.howItWorksTitle')}
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-12">
          {STEPS.map(({ icon: Icon, stepKey }, i) => (
            <div key={stepKey} className="flex flex-col items-center text-center gap-4">
              <div className="relative">
                <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
                  <Icon className="w-7 h-7 text-primary" />
                </div>
                <span className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-primary text-primary-foreground text-sm font-bold flex items-center justify-center">
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
