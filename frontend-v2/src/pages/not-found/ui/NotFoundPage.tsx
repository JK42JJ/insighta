import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Home } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import { Header } from '@/widgets/header/ui/Header';
import { Footer } from '@/widgets/header/ui/Footer';

export default function NotFoundPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />

      <main className="flex-1 flex items-center justify-center px-4">
        <div className="text-center space-y-6">
          <h1 className="text-7xl font-bold text-primary">404</h1>
          <h2 className="text-2xl font-semibold text-foreground">
            {t('notFound.title')}
          </h2>
          <p className="text-muted-foreground max-w-md mx-auto">
            {t('notFound.description')}
          </p>
          <Button
            size="lg"
            className="gap-2 rounded-xl"
            onClick={() => navigate('/')}
          >
            <Home className="w-4 h-4" aria-hidden="true" />
            {t('notFound.goHome')}
          </Button>
        </div>
      </main>

      <Footer />
    </div>
  );
}
