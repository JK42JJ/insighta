import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import { Label } from '@/shared/ui/label';
import { Switch } from '@/shared/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { useYouTubeAuth } from '@/features/youtube-sync/model/useYouTubeAuth';
import { useUpdateSyncSettings } from '@/features/youtube-sync/model/useYouTubeSync';
import { useToast } from '@/shared/lib/use-toast';
import { YouTubeConnectionCard } from './YouTubeConnectionCard';
import { LlmKeysSettingsTab } from './LlmKeysSettingsTab';
import type { SyncInterval } from '@/entities/youtube/model/types';

export function ConnectedServicesTab() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const ytAuth = useYouTubeAuth();
  const updateSettings = useUpdateSyncSettings();

  // UX guard (Plan 2): surface the propagation result so the user knows
  // the dropdown is no longer cosmetic. For interval changes we report
  // the new interval + how many cron schedules were re-registered.
  const handleSyncIntervalChange = (value: string) => {
    updateSettings.mutate(
      { syncInterval: value as SyncInterval },
      {
        onSuccess: (result) => {
          const intervalLabel = value === 'manual' ? t('youtube.syncManual', 'Manual') : value;
          toast({
            title: t('settings.syncIntervalUpdated', 'Sync interval updated'),
            description: t(
              'settings.syncIntervalUpdatedDesc',
              'Interval: {{interval}}. Applied to {{count}} playlist(s) immediately.',
              { interval: intervalLabel, count: result.schedulesUpdated }
            ),
          });
        },
        onError: (err) => {
          toast({
            title: t('settings.syncSettingsFailed', 'Failed to update sync settings'),
            description: err instanceof Error ? err.message : String(err),
            variant: 'destructive',
          });
        },
      }
    );
  };

  const handleAutoSyncToggle = (checked: boolean) => {
    updateSettings.mutate(
      { autoSyncEnabled: checked },
      {
        onSuccess: (result) => {
          toast({
            title: checked
              ? t('settings.autoSyncOn', 'Background sync enabled')
              : t('settings.autoSyncOff', 'Background sync disabled'),
            description: t('settings.autoSyncToggleDesc', 'Applied to {{count}} playlist(s).', {
              count: result.schedulesUpdated,
            }),
          });
        },
        onError: (err) => {
          toast({
            title: t('settings.syncSettingsFailed', 'Failed to update sync settings'),
            description: err instanceof Error ? err.message : String(err),
            variant: 'destructive',
          });
        },
      }
    );
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
