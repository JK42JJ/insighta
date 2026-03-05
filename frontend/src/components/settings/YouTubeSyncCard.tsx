import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useYouTubeAuth } from '@/hooks/useYouTubeAuth';
import { useYouTubeSync, useUpdateSyncSettings } from '@/hooks/useYouTubeSync';
import { YouTubeConnectButton } from './YouTubeConnectButton';
import { PlaylistItem } from './PlaylistItem';
import { Loader2, Plus, RefreshCw, Youtube, LogIn } from 'lucide-react';
import type { SyncInterval } from '@/types/youtube';

const SYNC_INTERVAL_KEYS: SyncInterval[] = ['manual', '1h', '6h', '12h', '24h'];

export function YouTubeSyncCard() {
  const { toast } = useToast();
  const { t } = useTranslation();
  const { isLoggedIn, isLoading: isAuthLoading, signInWithGoogle } = useAuth();
  const [playlistUrl, setPlaylistUrl] = useState('');
  const [syncingPlaylistId, setSyncingPlaylistId] = useState<string | null>(null);
  const [deletingPlaylistId, setDeletingPlaylistId] = useState<string | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);

  const { syncInterval, autoSyncEnabled } = useYouTubeAuth();

  const handleSignIn = async () => {
    setIsSigningIn(true);
    try {
      await signInWithGoogle();
    } catch (error) {
      console.error('Sign in failed:', error);
      toast({
        title: t('youtube.signInFailed'),
        description: error instanceof Error ? error.message : t('youtube.signInError'),
        variant: 'destructive',
      });
    } finally {
      setIsSigningIn(false);
    }
  };
  const {
    playlists,
    isLoading,
    isAdding,
    isSyncingAll,
    addPlaylist,
    syncPlaylist,
    deletePlaylist,
    syncAll,
  } = useYouTubeSync();
  const updateSettings = useUpdateSyncSettings();

  const handleAddPlaylist = async () => {
    if (!playlistUrl.trim()) {
      toast({
        title: t('common.error'),
        description: t('youtube.urlRequired'),
        variant: 'destructive',
      });
      return;
    }

    try {
      await addPlaylist(playlistUrl.trim());
      setPlaylistUrl('');
      toast({
        title: t('youtube.playlistAdded'),
        description: t('youtube.playlistAddedDesc'),
      });
    } catch (error) {
      toast({
        title: t('youtube.addFailed'),
        description: error instanceof Error ? error.message : t('youtube.addFailedDesc'),
        variant: 'destructive',
      });
    }
  };

  const handleSyncPlaylist = async (playlistId: string) => {
    setSyncingPlaylistId(playlistId);
    try {
      const result = await syncPlaylist(playlistId);
      toast({
        title: t('youtube.syncComplete'),
        description: t('youtube.syncCompleteDesc', {
          added: result.itemsAdded,
          removed: result.itemsRemoved,
        }),
      });
    } catch (error) {
      toast({
        title: t('youtube.syncFailed'),
        description: error instanceof Error ? error.message : t('youtube.syncError'),
        variant: 'destructive',
      });
    } finally {
      setSyncingPlaylistId(null);
    }
  };

  const handleDeletePlaylist = async (playlistId: string) => {
    setDeletingPlaylistId(playlistId);
    try {
      await deletePlaylist(playlistId);
      toast({
        title: t('youtube.deleted'),
        description: t('youtube.playlistDeleted'),
      });
    } catch (error) {
      toast({
        title: t('youtube.deleteFailed'),
        description: error instanceof Error ? error.message : t('youtube.deleteError'),
        variant: 'destructive',
      });
    } finally {
      setDeletingPlaylistId(null);
    }
  };

  const handleSyncAll = async () => {
    try {
      const result = await syncAll();
      toast({
        title: t('youtube.syncAllComplete'),
        description: t('youtube.syncAllCompleteDesc', {
          synced: result.synced,
          failed: result.failed,
        }),
        variant: result.failed > 0 ? 'destructive' : 'default',
      });
    } catch (error) {
      toast({
        title: t('youtube.syncFailed'),
        description: error instanceof Error ? error.message : t('youtube.syncError'),
        variant: 'destructive',
      });
    }
  };

  const handleSyncIntervalChange = async (value: SyncInterval) => {
    try {
      await updateSettings.mutateAsync({
        syncInterval: value,
        autoSyncEnabled: value !== 'manual',
      });
      toast({
        title: t('youtube.settingsSaved'),
        description: t('youtube.settingsSavedDesc', {
          interval: t(`youtube.syncInterval.${value}`),
        }),
      });
    } catch (error) {
      toast({
        title: t('youtube.settingsSaveFailed'),
        description: error instanceof Error ? error.message : t('youtube.settingsSaveError'),
        variant: 'destructive',
      });
    }
  };

  // Show login prompt if not authenticated
  if (isAuthLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Youtube className="h-5 w-5 text-red-600" />
            {t('youtube.syncTitle')}
          </CardTitle>
          <CardDescription>{t('youtube.syncDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!isLoggedIn) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Youtube className="h-5 w-5 text-red-600" />
            {t('youtube.syncTitle')}
          </CardTitle>
          <CardDescription>{t('youtube.syncDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 space-y-4">
            <div className="flex flex-col items-center gap-3">
              <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
                <LogIn className="h-8 w-8 text-muted-foreground" />
              </div>
              <div>
                <p className="font-medium">{t('youtube.loginRequired')}</p>
                <p className="text-sm text-muted-foreground">{t('youtube.loginRequiredDesc')}</p>
              </div>
            </div>
            <Button
              onClick={handleSignIn}
              disabled={isSigningIn}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {isSigningIn ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Youtube className="mr-2 h-4 w-4" />
              )}
              {t('youtube.signInWithGoogle')}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Youtube className="h-5 w-5 text-red-600" />
          {t('youtube.syncTitle')}
        </CardTitle>
        <CardDescription>{t('youtube.syncDesc')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Google Account Connection */}
        <div className="space-y-2">
          <Label>{t('youtube.googleAccount')}</Label>
          <p className="text-sm text-muted-foreground">{t('youtube.googleAccountDesc')}</p>
          <YouTubeConnectButton />
        </div>

        <Separator />

        {/* Add Playlist */}
        <div className="space-y-2">
          <Label htmlFor="playlist-url">{t('youtube.addPlaylist')}</Label>
          <div className="flex gap-2">
            <Input
              id="playlist-url"
              placeholder={t('youtube.playlistUrlPlaceholder')}
              value={playlistUrl}
              onChange={(e) => setPlaylistUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !isAdding) {
                  handleAddPlaylist();
                }
              }}
            />
            <Button onClick={handleAddPlaylist} disabled={isAdding || !playlistUrl.trim()}>
              {isAdding ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              <span className="ml-2 hidden sm:inline">{t('common.add')}</span>
            </Button>
          </div>
        </div>

        {/* Registered Playlists */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>
              {t('youtube.registeredPlaylists')} ({playlists.length})
            </Label>
            {playlists.length > 0 && (
              <Button variant="outline" size="sm" onClick={handleSyncAll} disabled={isSyncingAll}>
                {isSyncingAll ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                {t('youtube.syncAll')}
              </Button>
            )}
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : playlists.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Youtube className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>{t('youtube.noPlaylists')}</p>
              <p className="text-sm">{t('youtube.noPlaylistsHint')}</p>
            </div>
          ) : (
            <ScrollArea className="h-[300px]">
              <div className="space-y-2 pr-4">
                {playlists.map((playlist) => (
                  <PlaylistItem
                    key={playlist.id}
                    playlist={playlist}
                    onSync={handleSyncPlaylist}
                    onDelete={handleDeletePlaylist}
                    isSyncing={syncingPlaylistId === playlist.id}
                    isDeleting={deletingPlaylistId === playlist.id}
                  />
                ))}
              </div>
            </ScrollArea>
          )}
        </div>

        <Separator />

        {/* Sync Settings */}
        <div className="space-y-4">
          <Label>{t('youtube.syncSettings')}</Label>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="sync-interval" className="text-sm font-normal">
                {t('youtube.autoSyncInterval')}
              </Label>
              <p className="text-xs text-muted-foreground">{t('youtube.autoSyncIntervalDesc')}</p>
            </div>
            <Select
              value={syncInterval}
              onValueChange={(value) => handleSyncIntervalChange(value as SyncInterval)}
              disabled={updateSettings.isPending}
            >
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SYNC_INTERVAL_KEYS.map((key) => (
                  <SelectItem key={key} value={key}>
                    {t(`youtube.syncInterval.${key}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="auto-sync" className="text-sm font-normal">
                {t('youtube.backgroundSync')}
              </Label>
              <p className="text-xs text-muted-foreground">{t('youtube.backgroundSyncDesc')}</p>
            </div>
            <Switch
              id="auto-sync"
              checked={autoSyncEnabled}
              onCheckedChange={(checked) =>
                updateSettings.mutate({
                  autoSyncEnabled: checked,
                  syncInterval: checked && syncInterval === 'manual' ? '6h' : syncInterval,
                })
              }
              disabled={updateSettings.isPending}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
