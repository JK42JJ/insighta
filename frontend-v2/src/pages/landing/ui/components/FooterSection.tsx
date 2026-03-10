import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export function FooterSection() {
  const { t } = useTranslation();

  return (
    <footer className="border-t border-border/50 bg-background">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="py-10 md:py-14 flex flex-col md:flex-row justify-between gap-10">
          {/* Brand */}
          <div className="max-w-sm">
            <div className="flex items-center gap-2.5 mb-4">
              <img src={`${import.meta.env.BASE_URL}logo.png`} alt="Insighta" className="w-7 h-7 rounded-lg dark:invert" />
              <span className="text-lg font-bold">Insighta</span>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {t('landing.footerDesc')}
            </p>
          </div>

          {/* Link columns */}
          <div className="flex flex-wrap gap-12 sm:gap-16">
            <div>
              <h3 className="text-sm font-semibold mb-3">{t('landing.footerProduct')}</h3>
              <ul className="space-y-2">
                <li>
                  <a href="#features" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                    {t('landing.navFeatures')}
                  </a>
                </li>
                <li>
                  <Link to="/pricing" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                    {t('landing.navPricing')}
                  </Link>
                </li>
                <li>
                  <Link to="/templates" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                    {t('landing.navTemplates')}
                  </Link>
                </li>
              </ul>
            </div>

            <div>
              <h3 className="text-sm font-semibold mb-3">{t('landing.footerLegal')}</h3>
              <ul className="space-y-2">
                <li>
                  <Link to="/terms" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                    {t('footer.termsOfService')}
                  </Link>
                </li>
                <li>
                  <Link to="/privacy" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                    {t('footer.privacyPolicy')}
                  </Link>
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="border-t border-border/50 py-6">
          <p className="text-xs text-muted-foreground text-center">
            &copy; {new Date().getFullYear()} Insighta. {t('footer.allRightsReserved')}
          </p>
        </div>
      </div>
    </footer>
  );
}
