import { useTranslation } from 'react-i18next';
import { Star } from 'lucide-react';

interface Testimonial {
  nameKey: string;
  roleKey: string;
  quoteKey: string;
}

const TESTIMONIALS: Testimonial[] = [
  { nameKey: 'testimonial1Name', roleKey: 'testimonial1Role', quoteKey: 'testimonial1Quote' },
  { nameKey: 'testimonial2Name', roleKey: 'testimonial2Role', quoteKey: 'testimonial2Quote' },
  { nameKey: 'testimonial3Name', roleKey: 'testimonial3Role', quoteKey: 'testimonial3Quote' },
];

export function TestimonialsSection() {
  const { t } = useTranslation();

  return (
    <section className="py-20 md:py-28">
      <div className="mx-auto max-w-6xl px-4">
        <div className="text-center mb-14">
          <h2 className="text-3xl md:text-4xl font-semibold tracking-tight">
            {t('landing.testimonialsTitle')}
          </h2>
          <p className="text-muted-foreground mt-3 text-base">
            {t('landing.testimonialsSubtitle')}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {TESTIMONIALS.map((item) => (
            <div
              key={item.nameKey}
              className="rounded-xl border border-border/50 bg-card p-6 flex flex-col gap-4 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200"
              style={{ boxShadow: 'var(--shadow-sm)' }}
            >
              <div className="flex gap-1">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star key={i} className="w-4 h-4 fill-primary text-primary" />
                ))}
              </div>
              <p className="text-sm leading-relaxed text-foreground/90 flex-1">
                "{t(`landing.${item.quoteKey}`)}"
              </p>
              <div className="flex items-center gap-3 pt-2 border-t border-border/30">
                <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-sm">
                  {t(`landing.${item.nameKey}`).charAt(0)}
                </div>
                <div>
                  <p className="text-sm font-medium">{t(`landing.${item.nameKey}`)}</p>
                  <p className="text-xs text-muted-foreground">{t(`landing.${item.roleKey}`)}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
