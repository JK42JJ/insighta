import { BrowserRouter } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ErrorBoundary } from 'react-error-boundary';
import { QueryProvider } from './providers/QueryProvider';
import { ThemeProvider } from './providers/ThemeProvider';
import { AuthProvider } from '@/features/auth/model/AuthContext';
import { Toaster } from '@/shared/ui/sonner';
import { OfflineBanner, SwUpdatePrompt } from '@/widgets/offline-banner';
import { ErrorFallback } from '@/shared/ui/ErrorFallback';
import { AppShell } from '@/widgets/app-shell';
import { AppRouter } from './router';
import '@/shared/i18n/config';
import './styles/index.css';

function App() {
  const { t } = useTranslation();

  return (
    <BrowserRouter>
      <ErrorBoundary FallbackComponent={ErrorFallback} onReset={() => window.location.reload()}>
        <QueryProvider>
          <ThemeProvider>
            <AuthProvider>
              <a href="#main-content" className="skip-nav">
                {t('common.skipToContent', 'Skip to main content')}
              </a>
              <OfflineBanner />
              <AppShell>
                <AppRouter />
              </AppShell>
              <Toaster />
              <SwUpdatePrompt />
            </AuthProvider>
          </ThemeProvider>
        </QueryProvider>
      </ErrorBoundary>
    </BrowserRouter>
  );
}

export default App;
