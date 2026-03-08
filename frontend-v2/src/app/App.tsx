import { BrowserRouter } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { QueryProvider } from './providers/QueryProvider';
import { ThemeProvider } from './providers/ThemeProvider';
import { AuthProvider } from '@/features/auth/model/AuthContext';
import { Toaster } from '@/shared/ui/sonner';
import { OfflineBanner, SwUpdatePrompt } from '@/widgets/offline-banner';
import { AppRouter } from './router';
import '@/shared/i18n/config';
import './styles/index.css';

function App() {
  const { t } = useTranslation();

  return (
    <BrowserRouter basename="/v2">
      <QueryProvider>
        <ThemeProvider>
          <AuthProvider>
            <a href="#main-content" className="skip-nav">
              {t('common.skipToContent', 'Skip to main content')}
            </a>
            <OfflineBanner />
            <AppRouter />
            <Toaster />
            <SwUpdatePrompt />
          </AuthProvider>
        </ThemeProvider>
      </QueryProvider>
    </BrowserRouter>
  );
}

export default App;
