import { useTranslation } from 'react-i18next';
import { Grid3X3, GripVertical, Brain } from 'lucide-react';

const FEATURES = [
  { icon: Grid3X3, titleKey: 'feature1Title', descKey: 'feature1Desc' },
  { icon: GripVertical, titleKey: 'feature2Title', descKey: 'feature2Desc' },
  { icon: Brain, titleKey: 'feature3Title', descKey: 'feature3Desc' },
] as const;

export function FeatureCards() {
  const { t } = useTranslation();

  return (
    <section id="features" className="py-20 md:py-28">
      <div className="mx-auto max-w-6xl px-4">
        <div className="text-center mb-14">
          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-primary/10 text-primary mb-4">
            {t('landing.featuresLabel')}
          </span>
          <h2 className="text-3xl md:text-4xl font-semibold tracking-tight">
            {t('landing.featuresTitle')}
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {FEATURES.map(({ icon: Icon, titleKey, descKey }) => (
            <div
              key={titleKey}
              className="group rounded-xl border border-border/50 bg-card p-8 flex flex-col gap-5 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200"
              style={{ boxShadow: 'var(--shadow-sm)' }}
            >
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/15 transition-colors">
                <Icon className="w-6 h-6 text-primary" />
              </div>
              <h3 className="text-lg font-semibold tracking-tight">
                {t(`landing.${titleKey}`)}
              </h3>
              <p className="text-muted-foreground text-sm leading-relaxed">
                {t(`landing.${descKey}`)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
