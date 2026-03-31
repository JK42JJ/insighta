import { useTranslation } from 'react-i18next';

export function ExploreHero() {
  const { t } = useTranslation();

  return (
    <section className="text-center mb-11 relative">
      <div className="explore-hero-glow" />

      {/* Badge */}
      <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-[1.5px] uppercase text-primary bg-primary/10 px-3.5 py-1.5 rounded-full border border-primary/15 mb-4">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
        >
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
        {t('explore.hero.badge')}
      </div>

      {/* Title */}
      <h1 className="text-4xl font-bold tracking-tight leading-tight mb-3">
        {t('explore.hero.titleBefore')}
        <span className="explore-gradient-text">{t('explore.hero.titleHighlight')}</span>
        {t('explore.hero.titleAfter')}
      </h1>

      {/* Subtitle */}
      <p className="text-muted-foreground text-[15px] leading-relaxed max-w-[440px] mx-auto font-light">
        {t('explore.hero.subtitle')}
      </p>
    </section>
  );
}
