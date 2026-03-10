import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { Shield, Lock } from 'lucide-react';
import { useScrollReveal } from '@/shared/hooks/useScrollReveal';

export function CTASection() {
  const { t } = useTranslation();
  const sectionRef = useScrollReveal();

  return (
    <section className="py-20 md:py-28 relative overflow-hidden bg-foreground text-background">
      <div className="relative mx-auto max-w-3xl px-4 text-center" ref={sectionRef}>
        <h2 className="reveal text-3xl md:text-4xl font-bold tracking-tight">
          {t('landing.ctaTitle')}
        </h2>
        <p className="reveal reveal-delay-1 mt-4 text-lg text-background/70">
          {t('landing.ctaSubtitle')}
        </p>

        <div className="reveal reveal-delay-2 mt-10">
          <Link to="/pricing">
            <Button
              size="lg"
              className="rounded-full px-10 py-6 text-base bg-primary hover:bg-primary/90 text-primary-foreground border-0 shadow-lg"
            >
              {t('landing.ctaButton')}
            </Button>
          </Link>
          <p className="mt-4 text-sm text-background/50">
            {t('landing.ctaUrgency')}
          </p>
        </div>

        {/* Trust badges */}
        <div className="reveal reveal-delay-3 mt-8 flex items-center justify-center gap-6 text-sm text-background/60">
          <span className="flex items-center gap-1.5">
            <Shield className="w-4 h-4" />
            {t('landing.ctaGuarantee')}
          </span>
          <span className="flex items-center gap-1.5">
            <Lock className="w-4 h-4" />
            {t('landing.ctaSecure')}
          </span>
        </div>
      </div>
    </section>
  );
}
