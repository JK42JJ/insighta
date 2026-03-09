import { useState } from 'react';
import { X, Flame } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

export function LTDBanner() {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <div className="relative z-50 bg-foreground text-background">
      <div className="mx-auto max-w-7xl px-4 py-2.5 flex items-center justify-center gap-3 text-sm">
        <Flame className="w-4 h-4 text-primary shrink-0" aria-hidden="true" />
        <p className="font-medium">
          <span className="hidden sm:inline">{t('landing.ltdBanner')}</span>
          <span className="sm:hidden">{t('landing.ltdBannerShort')}</span>
        </p>
        <Link
          to="/pricing"
          className="inline-flex items-center px-3 py-1 rounded-full bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors whitespace-nowrap"
        >
          {t('landing.ltdBannerCta')}
        </Link>
        <button
          onClick={() => setDismissed(true)}
          className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-white/10 transition-colors"
          aria-label={t('common.close')}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
