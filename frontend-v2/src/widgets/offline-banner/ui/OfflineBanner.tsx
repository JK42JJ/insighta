import { useTranslation } from 'react-i18next';
import { WifiOff } from 'lucide-react';
import { useNetworkStatus } from '@/shared/hooks/useNetworkStatus';

export function OfflineBanner() {
  const { t } = useTranslation();
  const { isOffline } = useNetworkStatus();

  if (!isOffline) return null;

  return (
    <div
      role="alert"
      className="fixed top-0 left-0 right-0 z-50 flex items-center justify-center gap-2 bg-amber-600 px-4 py-2 text-sm font-medium text-white"
    >
      <WifiOff className="h-4 w-4" />
      {t('offline.banner', 'You are offline. Changes will sync when reconnected.')}
    </div>
  );
}
