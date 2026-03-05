import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useYouTubeAuth } from '@/hooks/useYouTubeAuth';
import { Loader2, Youtube, Check, X, AlertCircle, RefreshCw } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';

function useErrorMessage(error: unknown): { message: string; isAuthError: boolean } {
  const { t } = useTranslation();

  if (!error) return { message: '', isAuthError: false };

  const rawMessage = error instanceof Error ? error.message : String(error);

  const errorMap: Record<string, string> = {
    'Not authenticated': t('youtube.loginRequiredDesc'),
    'Popup blocked': t('youtube.connectError'),
    timeout: t('youtube.connectError'),
    Timeout: t('youtube.connectError'),
    'Failed to get auth URL': t('youtube.connectError'),
    'Failed to get auth status': t('youtube.connectError'),
    'Failed to disconnect': t('youtube.connectError'),
    network: t('youtube.connectError'),
    Network: t('youtube.connectError'),
  };

  for (const [key, msg] of Object.entries(errorMap)) {
    if (rawMessage.includes(key)) {
      return { message: msg, isAuthError: key === 'Not authenticated' };
    }
  }

  return { message: rawMessage, isAuthError: false };
}

export function YouTubeConnectButton() {
  const { t } = useTranslation();
  const {
    isConnected,
    isLoading,
    isConnecting,
    isDisconnecting,
    connect,
    disconnect,
    refetch,
    error,
  } = useYouTubeAuth();

  const { message: errorMessage, isAuthError } = useErrorMessage(error);

  if (isLoading) {
    return (
      <Button variant="outline" disabled>
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        {t('common.loading')}
      </Button>
    );
  }

  // Show error state with retry option
  if (error && !isAuthError) {
    return (
      <div className="space-y-3">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2">
          <RefreshCw className="h-4 w-4" />
          {t('common.confirm')}
        </Button>
      </div>
    );
  }

  if (isConnected) {
    return (
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
          <Check className="h-4 w-4" />
          <span>{t('youtube.connected')}</span>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm" disabled={isDisconnecting}>
              {isDisconnecting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <X className="mr-2 h-4 w-4" />
              )}
              {t('youtube.disconnect')}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('youtube.disconnectConfirm')}</AlertDialogTitle>
              <AlertDialogDescription>{t('youtube.disconnectDesc')}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
              <AlertDialogAction onClick={disconnect}>{t('youtube.disconnect')}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Button
        variant="default"
        onClick={connect}
        disabled={isConnecting}
        className="bg-red-600 hover:bg-red-700 text-white"
      >
        {isConnecting ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Youtube className="mr-2 h-4 w-4" />
        )}
        {t('youtube.connect')}
      </Button>
    </div>
  );
}
