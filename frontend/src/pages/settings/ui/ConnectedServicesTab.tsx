import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import { Label } from '@/shared/ui/label';
import { Switch } from '@/shared/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { useYouTubeAuth } from '@/features/youtube-sync/model/useYouTubeAuth';
import { useUpdateSyncSettings } from '@/features/youtube-sync/model/useYouTubeSync';
import { YouTubeConnectionCard } from './YouTubeConnectionCard';
import { LlmKeysSettingsTab } from './LlmKeysSettingsTab';
import type { SyncInterval } from '@/entities/youtube/model/types';

export function ConnectedServicesTab() {
  const { t } = useTranslation();
  const ytAuth = useYouTubeAuth();
  const updateSettings = useUpdateSyncSettings();

  const handleSyncIntervalChange = (value: string) => {
    updateSettings.mutate({ syncInterval: value as SyncInterval });
  };

  const handleAutoSyncToggle = (checked: boolean) => {
    updateSettings.mutate({ autoSyncEnabled: checked });
  };

  const handleAutoSummaryToggle = (checked: boolean) => {
    updateSettings.mutate({ autoSummaryEnabled: checked });
  };

  return (
    <div className="space-y-6">
      <YouTubeConnectionCard />
      <LlmKeysSettingsTab />

      {/* Sync Settings Card */}
      <Card className="bg-surface-mid border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t('youtube.syncSettings')}</CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-border/30">
          {/* Auto-sync interval */}
          <div className="flex items-center justify-between py-4">
            <div>
              <Label>{t('youtube.autoSyncInterval')}</Label>
              <p className="text-sm text-muted-foreground">{t('youtube.autoSyncIntervalDesc')}</p>
            </div>
            <Select value={ytAuth.syncInterval} onValueChange={handleSyncIntervalChange}>
              <SelectTrigger className="w-32 bg-surface-light border-border/50">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">{t('youtube.syncManual', 'Manual')}</SelectItem>
                <SelectItem value="1h">1h</SelectItem>
                <SelectItem value="6h">6h</SelectItem>
                <SelectItem value="12h">12h</SelectItem>
                <SelectItem value="24h">24h</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Background sync */}
          <div className="flex items-center justify-between py-4">
            <div>
              <Label>{t('youtube.backgroundSync')}</Label>
              <p className="text-sm text-muted-foreground">{t('youtube.backgroundSyncDesc')}</p>
            </div>
            <Switch checked={ytAuth.autoSyncEnabled} onCheckedChange={handleAutoSyncToggle} />
          </div>

          {/* AI summary auto-insert */}
          <div className="flex items-center justify-between py-4">
            <div>
              <Label>{t('settings.aiInsightReady', 'AI summary auto-insert')}</Label>
              <p className="text-sm text-muted-foreground">
                {t(
                  'settings.aiInsightReadyDesc',
                  'Automatically generate AI summary for synced videos'
                )}
              </p>
            </div>
            <Switch checked={ytAuth.autoSummaryEnabled} onCheckedChange={handleAutoSummaryToggle} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
