import { useTranslation } from 'react-i18next';
import { type FallbackProps } from 'react-error-boundary';
import { Button } from '@/shared/ui/button';

export function ErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="text-center max-w-md">
        <h1 className="text-2xl font-bold text-foreground mb-2">
          {t('error.title', 'Something went wrong')}
        </h1>
        <p className="text-muted-foreground mb-6">
          {t('error.description', 'An unexpected error occurred. Please try refreshing the page.')}
        </p>
        {error instanceof Error && error.message && (
          <pre className="mb-6 rounded-lg bg-surface-base p-4 text-left text-xs text-muted-foreground overflow-auto max-h-32">
            {error.message}
          </pre>
        )}
        <Button onClick={resetErrorBoundary}>
          {t('error.retry', 'Refresh page')}
        </Button>
      </div>
    </div>
  );
}
