import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Switch } from '@/shared/ui/switch';
import { Separator } from '@/shared/ui/separator';
import { useToast } from '@/shared/lib/use-toast';
import { useAuth } from '@/features/auth/model/useAuth';
import { useYouTubeAuth } from '@/features/youtube-sync/model/useYouTubeAuth';
import {
  useYouTubeSync,
  useUpdateSyncSettings,
  useYouTubeSearch,
} from '@/features/youtube-sync/model/useYouTubeSync';
import type { YouTubeSearchResult } from '@/features/youtube-sync/model/useYouTubeSync';
import { useAddLocalCard } from '@/features/card-management/model/useLocalCards';
import { PlaylistItem } from './PlaylistItem';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/shared/ui/collapsible';
import { cn } from '@/shared/lib/utils';
import { Loader2, Plus, RefreshCw, Youtube, LogIn, ChevronDown, Tv, Hash, Search, ExternalLink, Check } from 'lucide-react';
import type { SyncInterval } from '@/entities/youtube/model/types';

const SYNC_INTERVAL_KEYS: SyncInterval[] = ['manual', '1h', '6h', '12h', '24h'];

type SyncTab = 'playlists' | 'channels' | 'hashtags';

export function YouTubeSyncCard() {
  const { toast } = useToast();
  const { t } = useTranslation();
  const { isLoggedIn, isLoading: isAuthLoading, signInWithGoogle } = useAuth();
  const [isOpen, setIsOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<SyncTab>('playlists');
  const [playlistUrl, setPlaylistUrl] = useState('');
  const [channelUrl, setChannelUrl] = useState('');
  const [hashtagQuery, setHashtagQuery] = useState('');
  const [searchResults, setSearchResults] = useState<YouTubeSearchResult[]>([]);
  const [addedVideoIds, setAddedVideoIds] = useState<Set<string>>(new Set());
  const [isSigningIn, setIsSigningIn] = useState(false);

  const youtubeAuth = useYouTubeAuth();
  const ytSync = useYouTubeSync();
  const updateSettings = useUpdateSyncSettings();
  const youtubeSearch = useYouTubeSearch();
  const addLocalCard = useAddLocalCard();

  const syncInterval = (youtubeAuth.syncInterval as SyncInterval) || 'manual';
  const autoSyncEnabled = youtubeAuth.autoSyncEnabled;
  const autoSummaryEnabled = youtubeAuth.autoSummaryEnabled;
  const playlists = ytSync.playlists;
  const isLoading = ytSync.isLoading;
  const isAdding = ytSync.isAdding;
  const isSyncingAll = ytSync.isSyncingAll;
  const [syncingPlaylistId, setSyncingPlaylistId] = useState<string | null>(null);
  const [deletingPlaylistId, setDeletingPlaylistId] = useState<string | null>(null);

  const handleAddChannel = async () => {
    if (!channelUrl.trim()) {
      toast({
        title: t('common.error'),
        description: 'Please enter a YouTube channel URL.',
        variant: 'destructive',
      });
      return;
    }
    try {
      await ytSync.addPlaylist(channelUrl.trim());
      setChannelUrl('');
      toast({
        title: 'Channel Added',
        description: 'Channel uploads playlist has been imported.',
      });
    } catch (error) {
      toast({
        title: t('common.error'),
        description: error instanceof Error ? error.message : 'Failed to add channel.',
        variant: 'destructive',
      });
    }
  };

  const handleHashtagSearch = async () => {
    if (!hashtagQuery.trim()) return;
    try {
      const results = await youtubeSearch.mutateAsync({ query: hashtagQuery.trim(), maxResults: 20 });
      setSearchResults(results);
      setAddedVideoIds(new Set());
    } catch (error) {
      toast({
        title: t('common.error'),
        description: error instanceof Error ? error.message : 'Search failed.',
        variant: 'destructive',
      });
    }
  };

  const handleAddSearchResult = async (video: YouTubeSearchResult) => {
    try {
      const url = `https://www.youtube.com/watch?v=${video.videoId}`;
      await addLocalCard.mutateAsync({
        url,
        title: video.title,
        link_type: 'youtube',
        metadata_image: video.thumbnail,
        cell_index: -1,
      });
      setAddedVideoIds((prev) => new Set([...prev, video.videoId]));
      toast({
        title: 'Card Added',
        description: `"${video.title}" added to scratchpad.`,
      });
    } catch (error) {
      toast({
        title: t('common.error'),
        description: error instanceof Error ? error.message : 'Failed to add video.',
        variant: 'destructive',
      });
    }
  };

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

  const handleAutoSummaryToggle = async (checked: boolean) => {
    try {
      await updateSettings.mutateAsync({ autoSummaryEnabled: checked });
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
                <ChevronDown
                  className={cn(
                    'h-4 w-4 text-muted-foreground transition-transform duration-200',
                    isOpen && 'rotate-180'
                  )}
                />
              </div>
            </div>
            <CardDescription>{t('youtube.syncDesc')}</CardDescription>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-6">
            {/* Source Type Tabs */}
            <div className="flex gap-1 p-1 rounded-lg bg-surface-light/50 border border-border/30">
              {([
                { id: 'playlists' as SyncTab, icon: Youtube, label: 'Playlists' },
                { id: 'channels' as SyncTab, icon: Tv, label: 'Channels' },
                { id: 'hashtags' as SyncTab, icon: Hash, label: 'Hashtags' },
              ]).map(({ id, icon: Icon, label }) => (
                <button
                  key={id}
                  onClick={() => setActiveTab(id)}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex-1 justify-center',
                    activeTab === id
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{label}</span>
                </button>
              ))}
            </div>

            {/* Playlists Tab */}
            {activeTab === 'playlists' && (
              <>
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
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleSyncAll}
                        disabled={isSyncingAll}
                      >
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
              </>
            )}

            {/* Channels Tab */}
            {activeTab === 'channels' && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="channel-url">Add Channel</Label>
                  <p className="text-xs text-muted-foreground">
                    Paste a YouTube channel URL to import all uploaded videos as a playlist.
                  </p>
                  <div className="flex gap-2">
                    <Input
                      id="channel-url"
                      placeholder="https://www.youtube.com/@channelname"
                      value={channelUrl}
                      onChange={(e) => setChannelUrl(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !isAdding) {
                          handleAddChannel();
                        }
                      }}
                    />
                    <Button onClick={handleAddChannel} disabled={isAdding || !channelUrl.trim()}>
                      {isAdding ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Plus className="h-4 w-4" />
                      )}
                      <span className="ml-2 hidden sm:inline">{t('common.add')}</span>
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Supported formats: youtube.com/@handle, youtube.com/channel/UCxxxx, youtube.com/c/Name
                  </p>
                </div>

                {playlists.length > 0 && (
                  <div className="space-y-2">
                    <Label>Imported Channels ({playlists.filter(p => p.youtube_playlist_id.startsWith('UU')).length})</Label>
                    <div className="max-h-[320px] overflow-y-auto space-y-2 pr-1 scrollbar-thin">
                      {playlists
                        .filter(p => p.youtube_playlist_id.startsWith('UU'))
                        .map((playlist) => (
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
                  </div>
                )}
              </div>
            )}

            {/* Hashtags Tab — YouTube Search */}
            {activeTab === 'hashtags' && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="hashtag-search">Search Videos</Label>
                  <p className="text-xs text-muted-foreground">
                    Search YouTube by keyword or hashtag and add videos to your scratchpad.
                  </p>
                  <div className="flex gap-2">
                    <Input
                      id="hashtag-search"
                      placeholder="e.g. #machinelearning, React tutorial"
                      value={hashtagQuery}
                      onChange={(e) => setHashtagQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !youtubeSearch.isPending) {
                          handleHashtagSearch();
                        }
                      }}
                    />
                    <Button onClick={handleHashtagSearch} disabled={youtubeSearch.isPending || !hashtagQuery.trim()}>
                      {youtubeSearch.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Search className="h-4 w-4" />
                      )}
                      <span className="ml-2 hidden sm:inline">Search</span>
                    </Button>
                  </div>
                </div>

                {searchResults.length > 0 && (
                  <div className="space-y-2">
                    <Label>Results ({searchResults.length})</Label>
                    <div className="max-h-[400px] overflow-y-auto space-y-2 pr-1 scrollbar-thin">
                      {searchResults.map((video) => {
                        const isAdded = addedVideoIds.has(video.videoId);
                        return (
                          <div
                            key={video.videoId}
                            className="flex items-center gap-3 p-2 rounded-md border border-border/50 hover:bg-muted/30 transition-colors"
                          >
                            {video.thumbnail && (
                              <img
                                src={video.thumbnail}
                                alt={video.title}
                                className="w-24 h-14 object-cover rounded flex-shrink-0"
                              />
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{video.title}</p>
                              <p className="text-xs text-muted-foreground truncate">{video.channelTitle}</p>
                            </div>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              <Button
                                variant="ghost"
                                size="sm"
                                asChild
                                className="h-8 w-8 p-0"
                              >
                                <a
                                  href={`https://www.youtube.com/watch?v=${video.videoId}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </a>
                              </Button>
                              <Button
                                variant={isAdded ? 'ghost' : 'outline'}
                                size="sm"
                                onClick={() => handleAddSearchResult(video)}
                                disabled={isAdded || addLocalCard.isPending}
                                className="h-8"
                              >
                                {isAdded ? (
                                  <Check className="h-3.5 w-3.5 text-green-500" />
                                ) : (
                                  <Plus className="h-3.5 w-3.5" />
                                )}
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            <Separator />

            {/* Sync Settings */}
            <div className="space-y-4">
              <Label>{t('youtube.syncSettings')}</Label>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="sync-interval" className="text-sm font-normal">
                    {t('youtube.autoSyncInterval')}
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {t('youtube.autoSyncIntervalDesc')}
                  </p>
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

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="auto-summary" className="text-sm font-normal">
                    {t('youtube.autoSummary')}
                  </Label>
                  <p className="text-xs text-muted-foreground">{t('youtube.autoSummaryDesc')}</p>
                </div>
                <Switch
                  id="auto-summary"
                  checked={autoSummaryEnabled}
                  onCheckedChange={handleAutoSummaryToggle}
                />
              </div>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
