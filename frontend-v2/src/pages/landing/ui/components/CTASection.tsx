import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';

export function CTASection() {
  const { t } = useTranslation();

  return (
    <section className="py-20 md:py-28 bg-[#1E2437] text-white relative overflow-hidden">
      {/* Background pattern */}
      <div
        className="absolute inset-0 pointer-events-none opacity-5"
        style={{
          backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)',
          backgroundSize: '32px 32px',
        }}
      />

      <div className="relative mx-auto max-w-3xl px-4 text-center">
        <h2 className="text-3xl md:text-5xl font-bold tracking-tight">
          {t('landing.ctaTitle')}
        </h2>
        <p className="mt-4 text-lg text-white/70">
          {t('landing.ctaSubtitle')}
        </p>

        <div className="mt-10">
          <Link to="/pricing">
            <Button
              size="lg"
              className="rounded-full px-10 py-6 text-base bg-[#EC4D74] hover:bg-[#FF3668] text-white border-0 shadow-lg"
            >
              {t('landing.ctaButton')}
            </Button>
          </Link>
          <p className="mt-4 text-sm text-white/50">
            {t('landing.ctaUrgency')}
          </p>
        </div>
      </div>
    </section>
  );
}
