import { useTranslation } from 'react-i18next';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Button } from '@/shared/ui/button';

export function SwUpdatePrompt() {
  const { t } = useTranslation();
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl: string, registration: ServiceWorkerRegistration | undefined) {
      if (registration) {
        setInterval(() => registration.update(), 60 * 60 * 1000);
      }
    },
  });

  if (!needRefresh) return null;

  return (
    <div
      role="alert"
      className="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-lg border bg-card p-4 shadow-lg"
    >
      <p className="text-sm">{t('sw.updateAvailable', 'A new version is available.')}</p>
      <Button size="sm" onClick={() => updateServiceWorker(true)}>
        {t('sw.reload', 'Reload')}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setNeedRefresh(false)}>
        {t('sw.dismiss', 'Dismiss')}
      </Button>
    </div>
  );
}
