import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export function Footer() {
  const { t } = useTranslation();

  return (
    <footer className="py-6 text-center text-sm text-muted-foreground border-t border-border/50 bg-surface-mid/50">
      <div className="container mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <img src={`${import.meta.env.BASE_URL}logo.png`} alt="" className="w-5 h-5 dark:invert" aria-hidden="true" />
          <span className="font-medium text-foreground">{t('footer.brand')}</span>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/terms"
            className="hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded-sm"
          >
            {t('footer.termsOfService')}
          </Link>
          <span aria-hidden="true">&middot;</span>
          <Link
            to="/privacy"
            className="hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded-sm"
          >
            {t('footer.privacyPolicy')}
          </Link>
        </div>
        <p>
          &copy; {new Date().getFullYear()} Insighta. {t('footer.allRightsReserved')}
        </p>
      </div>
    </footer>
  );
}
