import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { useAuth } from '@/features/auth/model/useAuth';

export function LandingHeader({ onLogin }: { onLogin?: () => void }) {
  const { t } = useTranslation();
  const { signInWithGoogle } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const isLanding = location.pathname === '/' || location.pathname === '';

  const handleLogin =
    onLogin ??
    (async () => {
      try {
        await signInWithGoogle();
      } catch (error) {
        console.error('Login failed:', error);
      }
    });

  const handleFeaturesClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (isLanding) {
      document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' });
    } else {
      navigate('/', { state: { scrollTo: 'features' } });
    }
  };

  return (
    <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-md border-b border-border/30">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 h-14 flex items-center justify-between">
        {/* Logo */}
        <Link
          to="/"
          className="flex items-center gap-2.5"
          onClick={() => {
            if (isLanding) {
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }
          }}
        >
          <img
            src={`${import.meta.env.BASE_URL}logo.png`}
            alt="Insighta"
            className="w-7 h-7 rounded-lg dark:invert"
          />
          <span className="text-lg font-bold tracking-tight">Insighta</span>
        </Link>

        {/* Nav links */}
        <nav className="hidden md:flex items-center gap-6">
          <a
            href="#features"
            onClick={handleFeaturesClick}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {t('landing.navFeatures')}
          </a>
          <Link
            to="/pricing"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {t('landing.navPricing')}
          </Link>
          <Link
            to="/templates"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {t('landing.navTemplates')}
          </Link>
        </nav>

        {/* CTA */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={handleLogin}>
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
