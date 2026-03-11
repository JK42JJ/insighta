import { Loader2 } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { Footer } from '@/widgets/header/ui/Footer';
import { useAuth } from '@/features/auth/model/useAuth';

export default function LoginPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { isLoggedIn, isLoading, signInWithGoogle } = useAuth();
  const [searchParams] = useSearchParams();
  const [isSigningIn, setIsSigningIn] = useState(false);

  useEffect(() => {
    if (!isLoading && isLoggedIn) {
      const returnTo = searchParams.get('returnTo');
      const safeReturnTo = returnTo && returnTo.startsWith('/') && returnTo !== '/login' ? returnTo : '/';
      navigate(safeReturnTo, { replace: true });
    }
  }, [isLoggedIn, isLoading, navigate, searchParams]);

  const handleLogin = async () => {
    const returnTo = searchParams.get('returnTo');
    if (returnTo) sessionStorage.setItem('auth-return-to', returnTo);
    setIsSigningIn(true);
    try {
      await signInWithGoogle();
    } catch (error) {
      console.error('Login failed:', error);
    } finally {
      setIsSigningIn(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <div className="flex-1 flex items-center justify-center px-4">
        <div className="w-full max-w-md space-y-8">
          {/* Logo & Branding */}
          <div className="text-center space-y-4">
            <div className="flex justify-center">
              <img
                src={`${import.meta.env.BASE_URL}logo.png`}
                alt="Insighta"
                className="w-14 h-14 rounded-2xl dark:invert"
              />
            </div>
            <div>
              <div className="flex items-center justify-center gap-2">
                <h1 className="text-3xl font-bold text-foreground tracking-tight">Insighta</h1>
                <span className="inline-flex items-center px-2 py-0.5 text-xs font-semibold uppercase tracking-wider bg-primary/10 text-primary border border-primary/30 rounded-md">
                  {t('common.beta')}
                </span>
              </div>
              <p className="mt-2 text-muted-foreground">{t('login.subtitle')}</p>
            </div>
          </div>

          {/* Description */}
          <div className="bg-surface-mid/50 rounded-xl p-6 border border-border/50 space-y-4">
            <h2 className="text-lg font-semibold text-foreground">{t('login.heading')}</h2>
            <ul className="space-y-3 text-sm text-muted-foreground">
              {(['feature1', 'feature2', 'feature3', 'feature4'] as const).map((key) => (
                <li key={key} className="flex items-start gap-2">
                  <span className="text-primary mt-0.5">&#8226;</span>
                  <span>{t(`login.${key}`)}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Login Button */}
          <div className="space-y-4">
            <Button
              className="w-full h-12 text-base font-medium gap-2 rounded-xl"
              onClick={handleLogin}
              disabled={isSigningIn}
              size="lg"
            >
              {isSigningIn ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path
                    fill="currentColor"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="currentColor"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="currentColor"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  />
                  <path
                    fill="currentColor"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  />
                </svg>
              )}
              {t('login.continueWithGoogle')}
            </Button>

            <p className="text-center text-xs text-muted-foreground">
              {t('login.agreeToTerms')}{' '}
              <Link
                to="/terms"
                className="text-foreground underline hover:text-primary transition-colors"
              >
                {t('login.termsOfService')}
              </Link>{' '}
              {t('login.and')}{' '}
              <Link
                to="/privacy"
                className="text-foreground underline hover:text-primary transition-colors"
              >
                {t('login.privacyPolicy')}
              </Link>
              {t('login.agreeSuffix')}
            </p>
          </div>
        </div>
      </div>

      <Footer />
    </div>
  );
}
