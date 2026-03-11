import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { CheckCircle2, Play } from 'lucide-react';

export function HeroSection() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const isKo = i18n.language === 'ko';

  return (
    <section className="relative pt-20 pb-16 md:pt-28 md:pb-24 overflow-hidden">
      <div className="relative mx-auto max-w-4xl px-4 text-center">
        {/* Hero label pill */}
        <span className="inline-flex items-center px-4 py-1.5 rounded-full text-xs font-semibold bg-primary/10 text-primary mb-6 animate-[fade-in_0.5s_ease]">
          {t('landing.heroLabel')}
        </span>

        <h1
          className={`font-bold tracking-tight font-serif animate-[fade-in-up_0.6s_ease] text-balance break-keep-all ${isKo ? 'text-3xl sm:text-4xl md:text-5xl' : 'text-4xl sm:text-5xl md:text-6xl leading-tight'}`}
        >
          {isKo ? (
            <>
              <span className="block">9칸의 제약이</span>
              <span className="block mt-3">사고를 더 선명하게 만듭니다</span>
            </>
          ) : (
            t('landing.heroTitle')
          )}
        </h1>

        <p className="mt-6 text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed md:whitespace-pre-line animate-[fade-in-up_0.6s_ease_0.15s_both]">
          {t('landing.heroSubtitle')}
        </p>

        {/* CTA buttons */}
        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4 animate-[fade-in-up_0.6s_ease_0.3s_both]">
          <Link to="/pricing">
            <Button
              size="lg"
              className="rounded-full px-8 py-6 text-base bg-primary hover:bg-primary/90 text-primary-foreground border-0 shadow-lg hover:shadow-xl transition-all"
            >
              {t('landing.heroCta')}
            </Button>
          </Link>
          <Button
            variant="outline"
            size="lg"
            className="rounded-full px-8 py-6 text-base gap-2"
            onClick={() => navigate('/login')}
          >
            <Play className="w-4 h-4" />
            {t('landing.heroSecondary')}
          </Button>
        </div>

        {/* Product mockup: 3x3 CSS grid */}
        <div className="mt-14 mx-auto max-w-xs animate-[fade-in-up_0.6s_ease_0.45s_both]">
          <div className="grid grid-cols-3 gap-2">
            {Array.from({ length: 9 }).map((_, i) => (
              <div
                key={i}
                className={`aspect-square rounded-xl ${
                  i === 4
                    ? 'bg-primary/20 border-2 border-primary/40'
                    : 'bg-muted/50 border border-border/30'
                } transition-colors`}
              />
            ))}
          </div>
        </div>

        {/* Social proof — pill bar style */}
        <div className="mt-10 inline-flex flex-wrap items-center justify-center gap-3 animate-[fade-in_0.6s_ease_0.6s_both]">
          {(['socialProof1', 'socialProof2', 'socialProof3'] as const).map((key) => (
            <span
              key={key}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-muted text-sm text-muted-foreground"
            >
              <CheckCircle2 className="w-3.5 h-3.5 text-primary" />
              {t(`landing.${key}`)}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
