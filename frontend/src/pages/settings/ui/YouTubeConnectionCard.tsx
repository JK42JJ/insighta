import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import { Button } from '@/shared/ui/button';
import { Loader2, Youtube, CheckCircle2, CircleOff } from 'lucide-react';
import { useYouTubeAuth } from '@/features/youtube-sync/model/useYouTubeAuth';
import { useAuth } from '@/features/auth/model/useAuth';

export function YouTubeConnectionCard() {
  const { t } = useTranslation();
  const ytAuth = useYouTubeAuth();
  const { userEmail } = useAuth();

  return (
    <Card className="bg-surface-mid border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Youtube className="h-5 w-5 text-red-600" />
          {t('youtube.connectionStatus')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {ytAuth.isLoading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : ytAuth.isConnected ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0" />
              <div>
                <span className="text-sm font-medium">{userEmail || t('youtube.connected')}</span>
                <p className="text-xs text-muted-foreground mt-0.5">{t('youtube.connected')}</p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="border-border/50 text-muted-foreground hover:text-destructive hover:border-destructive/50"
              onClick={ytAuth.disconnect}
              disabled={ytAuth.isDisconnecting}
            >
              {ytAuth.isDisconnecting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                t('youtube.disconnectGoogle')
              )}
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CircleOff className="h-5 w-5 text-muted-foreground flex-shrink-0" />
              <div>
                <span className="text-sm font-medium text-muted-foreground">
                  {t('youtube.notConnected')}
                </span>
                <p className="text-xs text-muted-foreground mt-0.5">{t('youtube.connectDesc')}</p>
              </div>
            </div>
            <Button
              size="sm"
              className="bg-red-600 hover:bg-red-700 text-white gap-1.5"
              onClick={ytAuth.connect}
              disabled={ytAuth.isConnecting}
            >
              {ytAuth.isConnecting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Youtube className="h-3.5 w-3.5" />
              )}
              {t('youtube.connectGoogle')}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
