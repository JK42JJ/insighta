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
import { ScrollArea } from '@/shared/ui/scroll-area';
import { useToast } from '@/shared/lib/use-toast';
import { useAuth } from '@/features/auth/model/useAuth';
// TODO: Migrate YouTube hooks to @/features/youtube/model/
// import { useYouTubeAuth } from '@/features/youtube/model/useYouTubeAuth';
// import { useYouTubeSync, useUpdateSyncSettings } from '@/features/youtube/model/useYouTubeSync';
import { PlaylistItem } from './PlaylistItem';
import { Loader2, Plus, RefreshCw, Youtube, LogIn } from 'lucide-react';
// TODO: Move SyncInterval type to @/shared/types/youtube when YouTube feature is migrated
// import type { SyncInterval } from '@/shared/types/youtube';

type SyncInterval = 'manual' | '1h' | '6h' | '12h' | '24h';

const SYNC_INTERVAL_KEYS: SyncInterval[] = ['manual', '1h', '6h', '12h', '24h'];

// TODO: This component requires YouTube hooks migration (useYouTubeAuth, useYouTubeSync, useUpdateSyncSettings).
// Currently using placeholder state. Wire up real hooks when YouTube feature layer is built.
export function YouTubeSyncCard() {
  const { toast } = useToast();
  const { t } = useTranslation();
  const { isLoggedIn, isLoading: isAuthLoading, signInWithGoogle } = useAuth();
  const [playlistUrl, setPlaylistUrl] = useState('');
  const [isSigningIn, setIsSigningIn] = useState(false);

  // Placeholder state until YouTube hooks are migrated
  const syncInterval: SyncInterval = 'manual';
  const autoSyncEnabled = false;
  const playlists: never[] = [];
  const isLoading = false;
  const isAdding = false;
  const isSyncingAll = false;
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
    // TODO: Wire up addPlaylist from useYouTubeSync
    toast({
      title: 'Not implemented',
      description: 'YouTube sync hooks not yet migrated.',
    });
  };

  const handleSyncPlaylist = async (_playlistId: string) => {
    // TODO: Wire up syncPlaylist from useYouTubeSync
  };

  const handleDeletePlaylist = async (_playlistId: string) => {
    // TODO: Wire up deletePlaylist from useYouTubeSync
  };

  const handleSyncAll = async () => {
    // TODO: Wire up syncAll from useYouTubeSync
  };

  const handleSyncIntervalChange = async (_value: SyncInterval) => {
    // TODO: Wire up updateSettings from useUpdateSyncSettings
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
                {playlists.map((playlist: never) => (
                  <PlaylistItem
                    key={(playlist as { id: string }).id}
                    playlist={playlist}
                    onSync={handleSyncPlaylist}
                    onDelete={handleDeletePlaylist}
                    isSyncing={syncingPlaylistId === (playlist as { id: string }).id}
                    isDeleting={deletingPlaylistId === (playlist as { id: string }).id}
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
              onCheckedChange={(_checked) => {
                // TODO: Wire up updateSettings.mutate when YouTube hooks are migrated
              }}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
