import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { CheckCircle2, Play } from 'lucide-react';

export function HeroSection({ onLogin }: { onLogin: () => void }) {
  const { t } = useTranslation();

  return (
    <section className="relative pt-20 pb-16 md:pt-28 md:pb-24 overflow-hidden">
      {/* Background gradient */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse at 50% 0%, hsl(var(--primary) / 0.06) 0%, transparent 70%)',
        }}
      />

      <div className="relative mx-auto max-w-4xl px-4 text-center">
        <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold leading-[1.1] tracking-tight">
          {t('landing.heroTitle')}
        </h1>

        <p className="mt-6 text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
          {t('landing.heroSubtitle')}
        </p>

        {/* CTA buttons */}
        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link to="/pricing">
            <Button
              size="lg"
              className="rounded-full px-8 py-6 text-base bg-[#EC4D74] hover:bg-[#FF3668] text-white border-0 shadow-lg hover:shadow-xl transition-all"
            >
              {t('landing.heroCta')}
            </Button>
          </Link>
          <Button
            variant="outline"
            size="lg"
            className="rounded-full px-8 py-6 text-base gap-2"
            onClick={onLogin}
          >
            <Play className="w-4 h-4" />
            {t('landing.heroSecondary')}
          </Button>
        </div>

        {/* Social proof */}
        <div className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-primary" />
            {t('landing.socialProof1')}
          </span>
          <span className="flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-primary" />
            {t('landing.socialProof2')}
          </span>
          <span className="flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-primary" />
            {t('landing.socialProof3')}
          </span>
        </div>
      </div>
    </section>
  );
}
