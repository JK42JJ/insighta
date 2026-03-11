import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/select';
import { Switch } from '@/shared/ui/switch';
import { Separator } from '@/shared/ui/separator';
import { useToast } from '@/shared/lib/use-toast';
import { useAuth } from '@/features/auth/model/useAuth';
import { useYouTubeAuth } from '@/features/youtube-sync/model/useYouTubeAuth';
import { useYouTubeSync, useUpdateSyncSettings } from '@/features/youtube-sync/model/useYouTubeSync';
import { PlaylistItem } from './PlaylistItem';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/shared/ui/collapsible';
import { cn } from '@/shared/lib/utils';
import { Loader2, Plus, RefreshCw, Youtube, LogIn, ChevronDown } from 'lucide-react';
import type { SyncInterval } from '@/entities/youtube/model/types';

const SYNC_INTERVAL_KEYS: SyncInterval[] = ['manual', '1h', '6h', '12h', '24h'];

export function YouTubeSyncCard() {
  const { toast } = useToast();
  const { t } = useTranslation();
  const { isLoggedIn, isLoading: isAuthLoading, signInWithGoogle } = useAuth();
  const [isOpen, setIsOpen] = useState(true);
  const [playlistUrl, setPlaylistUrl] = useState('');
  const [isSigningIn, setIsSigningIn] = useState(false);

  const youtubeAuth = useYouTubeAuth();
  const ytSync = useYouTubeSync();
  const updateSettings = useUpdateSyncSettings();

  const syncInterval = (youtubeAuth.syncInterval as SyncInterval) || 'manual';
  const autoSyncEnabled = youtubeAuth.autoSyncEnabled;
  const playlists = ytSync.playlists;
  const isLoading = ytSync.isLoading;
  const isAdding = ytSync.isAdding;
  const isSyncingAll = ytSync.isSyncingAll;
  const [syncingPlaylistId, setSyncingPlaylistId] = useState<string | null>(null);
  const [deletingPlaylistId, setDeletingPlaylistId] = useState<string | null>(null);

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
      await ytSync.addPlaylist(playlistUrl.trim());
      setPlaylistUrl('');
      toast({
        title: t('youtube.playlistAdded'),
        description: t('youtube.playlistAddedDesc'),
      });
    } catch (error) {
      toast({
        title: t('common.error'),
        description: error instanceof Error ? error.message : t('youtube.addPlaylistFailed'),
        variant: 'destructive',
      });
    }
  };

  const handleSyncPlaylist = async (playlistId: string) => {
    setSyncingPlaylistId(playlistId);
    try {
      const result = await ytSync.syncPlaylist(playlistId);
      toast({
        title: t('youtube.syncComplete'),
        description: t('youtube.syncCompleteDesc', {
          added: String(result.itemsAdded),
          removed: String(result.itemsRemoved),
        }),
      });
    } catch (error) {
      toast({
        title: t('youtube.syncFailed'),
        description: error instanceof Error ? error.message : t('youtube.syncFailedDesc'),
        variant: 'destructive',
      });
    } finally {
      setSyncingPlaylistId(null);
    }
  };

  const handleDeletePlaylist = async (playlistId: string) => {
    setDeletingPlaylistId(playlistId);
    try {
      await ytSync.deletePlaylist(playlistId);
      toast({
        title: t('youtube.playlistDeleted'),
        description: t('youtube.playlistDeletedDesc'),
      });
    } catch (error) {
      toast({
        title: t('common.error'),
        description: error instanceof Error ? error.message : t('youtube.deletePlaylistFailed'),
        variant: 'destructive',
      });
    } finally {
      setDeletingPlaylistId(null);
    }
  };

  const handleSyncAll = async () => {
    try {
      const result = await ytSync.syncAll();
      toast({
        title: t('youtube.syncAllComplete'),
        description: t('youtube.syncAllCompleteDesc', {
          synced: String(result.synced),
          failed: String(result.failed),
        }),
      });
    } catch (error) {
      toast({
        title: t('youtube.syncFailed'),
        description: error instanceof Error ? error.message : t('youtube.syncFailedDesc'),
        variant: 'destructive',
      });
    }
  };

  const handleSyncIntervalChange = async (value: SyncInterval) => {
    try {
      await updateSettings.mutateAsync({ syncInterval: value });
    } catch (error) {
      toast({
        title: t('common.error'),
        description: error instanceof Error ? error.message : t('youtube.settingsUpdateFailed'),
        variant: 'destructive',
      });
    }
  };

  const handleAutoSyncToggle = async (checked: boolean) => {
    try {
      await updateSettings.mutateAsync({ autoSyncEnabled: checked });
    } catch (error) {
      toast({
        title: t('common.error'),
        description: error instanceof Error ? error.message : t('youtube.settingsUpdateFailed'),
        variant: 'destructive',
      });
    }
  };

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
              className="bg-red-600 hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-600 text-white"
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
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer select-none">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Youtube className="h-5 w-5 text-red-600" />
                {t('youtube.syncTitle')}
              </CardTitle>
              <div className="flex items-center gap-3">
                {!isOpen && playlists.length > 0 && (
                  <span className="text-sm text-muted-foreground">
                    {playlists.length} playlists
                  </span>
                )}
                <ChevronDown className={cn(
                  "h-4 w-4 text-muted-foreground transition-transform duration-200",
                  isOpen && "rotate-180"
                )} />
              </div>
            </div>
            <CardDescription>{t('youtube.syncDesc')}</CardDescription>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-6">
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
                <div className="max-h-[480px] overflow-y-auto space-y-2 pr-1 scrollbar-thin">
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
                  onCheckedChange={handleAutoSyncToggle}
                />
              </div>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
