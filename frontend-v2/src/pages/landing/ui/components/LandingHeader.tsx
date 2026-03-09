import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';

export function LandingHeader({ onLogin }: { onLogin: () => void }) {
  const { t } = useTranslation();

  return (
    <header className="sticky top-0 z-40 bg-background/95 backdrop-blur-md border-b border-border/30">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 h-14 flex items-center justify-between">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2.5">
          <img src={`${import.meta.env.BASE_URL}logo.png`} alt="Insighta" className="w-8 h-8 rounded-lg dark:invert" />
          <span className="text-lg font-bold tracking-tight">Insighta</span>
        </Link>

        {/* Nav links */}
        <nav className="hidden md:flex items-center gap-6">
          <a href="#features" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            {t('landing.navFeatures')}
          </a>
          <Link to="/pricing" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            {t('landing.navPricing')}
          </Link>
          <Link to="/templates" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            {t('landing.navTemplates')}
          </Link>
        </nav>

        {/* CTA */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onLogin}>
            {t('common.login')}
          </Button>
          <Link to="/pricing">
            <Button
              size="sm"
              className="rounded-full px-5 bg-primary hover:bg-primary/90 text-primary-foreground border-0"
            >
              {t('landing.getStarted')}
            </Button>
          </Link>
        </div>
      </div>
    </header>
  );
}
