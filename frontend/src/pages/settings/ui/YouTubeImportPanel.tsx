/**
 * YouTube Import Panel — multi-select for subscriptions & playlists
 *
 * Fetches user's YouTube library via OAuth and displays as checkboxes.
 * Imports selected items as playlists via existing importPlaylist API.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { Label } from '@/shared/ui/label';
import { Loader2, Check, Youtube, ListVideo } from 'lucide-react';
import { useToast } from '@/shared/lib/use-toast';
import { apiClient } from '@/shared/lib/api-client';
import { cn } from '@/shared/lib/utils';
import { useYouTubeAuth } from '@/features/youtube-sync/model/useYouTubeAuth';
import {
  useYouTubeSubscriptions,
  useYouTubePlaylists,
  type YouTubeSubscriptionItem,
  type YouTubePlaylistItem,
} from '@/features/youtube-sync/model/useYouTubeLibrary';

interface YouTubeImportPanelProps {
  registeredPlaylistIds: Set<string>;
  onImportComplete: () => void;
}

type ImportTab = 'playlists' | 'subscriptions';
type SortOption = 'name' | 'count' | 'date';

export function YouTubeImportPanel({
  registeredPlaylistIds,
  onImportComplete,
}: YouTubeImportPanelProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<ImportTab>('playlists');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isImporting, setIsImporting] = useState(false);
  const [sortBy, setSortBy] = useState<SortOption>('name');

  const ytAuth = useYouTubeAuth();
  const subs = useYouTubeSubscriptions(ytAuth.isConnected);
  const pls = useYouTubePlaylists(ytAuth.isConnected);

  const subscriptions = subs.data?.pages.flatMap((p) => p.data) ?? [];
  const playlists = pls.data?.pages.flatMap((p) => p.data) ?? [];
  const subsLoading = subs.isLoading;
  const playlistsLoading = pls.isLoading;
  const subsError = subs.error;
  const playlistsError = pls.error;

  const isNotConnected =
    !ytAuth.isConnected ||
    (subsError as { code?: string })?.code === 'YOUTUBE_NOT_CONNECTED' ||
    (playlistsError as { code?: string })?.code === 'YOUTUBE_NOT_CONNECTED';

  // B-2: Counts for tabs
  const playlistCount = playlists.length;
  const subsCount = subscriptions.length;

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleImport = async () => {
    if (selectedIds.size === 0) return;
    setIsImporting(true);

    let successCount = 0;
    let failCount = 0;

    for (const id of selectedIds) {
      try {
        const url =
          activeTab === 'playlists'
            ? `https://www.youtube.com/playlist?list=${id}`
            : `https://www.youtube.com/channel/${id}`;
        await apiClient.importPlaylist(url);
        successCount++;
      } catch {
        failCount++;
      }
    }

    setIsImporting(false);
    setSelectedIds(new Set());

    if (successCount > 0) {
      toast({
        title: t('youtube.importSuccess', 'Imported successfully'),
        description: t('youtube.importSuccessDesc', {
          success: successCount,
          failSuffix: failCount > 0 ? t('youtube.importFailSuffix', { count: failCount }) : '',
        }),
      });
      onImportComplete();
    } else {
      toast({
        title: t('youtube.importFailed', 'Import failed'),
        description: t('youtube.importFailedDesc', { count: failCount }),
        variant: 'destructive',
      });
    }
  };

  // B-1: Not connected → show connect button
  if (isNotConnected) {
    return (
      <div className="space-y-3">
        <Label>{t('youtube.importFromLibrary', 'Import from YouTube')}</Label>
        <div className="text-center py-6 rounded-lg border border-border/30 bg-surface-light/30">
          <Youtube className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm text-muted-foreground">
            {t('youtube.connectFirst', 'Connect your YouTube account to import your library')}
          </p>
          <Button
            size="sm"
            className="mt-3 bg-red-600 hover:bg-red-700 text-white gap-1.5"
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
      </div>
    );
  }

  // B-3: Sort items
  const rawItems: Array<{
    id: string;
    title: string;
    subtitle: string;
    thumbnailUrl: string;
    isRegistered: boolean;
    itemCount: number;
    date: string;
  }> =
    activeTab === 'playlists'
      ? (playlists || []).map((p: YouTubePlaylistItem) => ({
          id: p.playlistId,
          title: p.title,
          subtitle: t('playlist.videoCount', { count: p.itemCount }),
          thumbnailUrl: p.thumbnailUrl,
          isRegistered: registeredPlaylistIds.has(p.playlistId),
          itemCount: p.itemCount,
          date: p.publishedAt,
        }))
      : (subscriptions || []).map((s: YouTubeSubscriptionItem) => ({
          id: s.channelId,
          title: s.title,
          subtitle: s.description.slice(0, 60) || t('youtube.channel'),
          thumbnailUrl: s.thumbnailUrl,
          isRegistered: registeredPlaylistIds.has(s.channelId),
          itemCount: 0,
          date: s.publishedAt,
        }));

  const items = [...rawItems].sort((a, b) => {
    if (sortBy === 'name') return a.title.localeCompare(b.title);
    if (sortBy === 'count') return b.itemCount - a.itemCount;
    return new Date(b.date).getTime() - new Date(a.date).getTime();
  });

  const isLoading = activeTab === 'playlists' ? playlistsLoading : subsLoading;
  const activeQuery = activeTab === 'playlists' ? pls : subs;
  const hasNextPage = activeQuery.hasNextPage;
  const isFetchingNextPage = activeQuery.isFetchingNextPage;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label>{t('youtube.importFromLibrary', 'Import from YouTube')}</Label>
        {selectedIds.size > 0 && (
          <Button size="sm" onClick={handleImport} disabled={isImporting} className="gap-1.5">
            {isImporting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
            {/* B-4: Clear label */}
            {t('youtube.addSelected', { count: selectedIds.size })}
          </Button>
        )}
      </div>

      {/* Sub-tabs with counts (B-2) */}
      <div className="flex gap-1 p-0.5 rounded-md bg-surface-light/30 border border-border/20">
        {[
          {
            id: 'playlists' as ImportTab,
            icon: ListVideo,
            label: t('youtube.tabPlaylists'),
            count: playlistCount,
          },
          {
            id: 'subscriptions' as ImportTab,
            icon: Youtube,
            label: t('youtube.tabSubscriptions'),
            count: subsCount,
          },
        ].map(({ id, icon: Icon, label, count }) => (
          <button
            key={id}
            onClick={() => {
              setActiveTab(id);
              setSelectedIds(new Set());
            }}
            className={cn(
              'flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors flex-1 justify-center',
              activeTab === id
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Icon className="h-3 w-3" />
            {label}
            {count > 0 && <span className="text-[10px] opacity-70">({count})</span>}
          </button>
        ))}
      </div>

      {/* B-3: Sort options */}
      {items.length > 0 && (
        <div className="flex items-center gap-1.5">
          {(['name', 'count', 'date'] as SortOption[]).map((opt) => (
            <button
              key={opt}
              onClick={() => setSortBy(opt)}
              className={cn(
                'px-2 py-0.5 rounded text-[10px] font-medium transition-colors',
                sortBy === opt
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {opt === 'name' && t('common.name', 'Name')}
              {opt === 'count' && t('common.videos', 'Videos')}
              {opt === 'date' && t('common.date', 'Date')}
            </button>
          ))}
        </div>
      )}

      {/* Items list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">
          {activeTab === 'playlists'
            ? t('youtube.noPlaylists', 'No playlists found in your YouTube account')
            : t('youtube.noSubscriptions', 'No subscriptions found')}
        </p>
      ) : (
        <div className="max-h-64 overflow-y-auto space-y-1 rounded-md border border-border/30 p-1">
          {items.map((item) => (
            <button
              key={item.id}
              onClick={() => !item.isRegistered && toggleSelection(item.id)}
              disabled={item.isRegistered}
              className={cn(
                'w-full flex items-center gap-3 px-2.5 py-2 rounded-md text-left transition-colors',
                item.isRegistered
                  ? 'opacity-50 cursor-default'
                  : selectedIds.has(item.id)
                    ? 'bg-primary/10 border border-primary/30'
                    : 'hover:bg-muted/50'
              )}
            >
              {/* Checkbox */}
              <div
                className={cn(
                  'w-4 h-4 rounded border flex items-center justify-center flex-shrink-0',
                  item.isRegistered
                    ? 'bg-green-500/20 border-green-500/50'
                    : selectedIds.has(item.id)
                      ? 'bg-primary border-primary'
                      : 'border-border'
                )}
              >
                {(item.isRegistered || selectedIds.has(item.id)) && (
                  <Check className="h-3 w-3 text-white" />
                )}
              </div>

              {/* Thumbnail */}
              {item.thumbnailUrl && (
                <img
                  src={item.thumbnailUrl}
                  alt=""
                  className="w-8 h-8 rounded object-cover flex-shrink-0"
                  draggable={false}
                />
              )}

              {/* Info */}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{item.title}</p>
                <p className="text-xs text-muted-foreground truncate">{item.subtitle}</p>
              </div>

              {/* B-4: "등록됨" label */}
              {item.isRegistered && (
                <span className="text-[10px] text-green-600 bg-green-500/10 px-1.5 py-0.5 rounded-full flex-shrink-0">
                  {t('youtube.registered', 'Registered')}
                </span>
              )}
            </button>
          ))}
          {hasNextPage && (
            <button
              onClick={() => activeQuery.fetchNextPage()}
              disabled={isFetchingNextPage}
              className="w-full py-2 text-xs text-primary hover:text-primary/80 font-medium transition-colors"
            >
              {isFetchingNextPage ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mx-auto" />
              ) : (
                t('youtube.loadMore', 'Load more...')
              )}
            </button>
          )}
        </div>
      )}

      {/* B-5: Channel/Hashtag coming soon */}
      <p className="text-[11px] text-muted-foreground">
        {t('youtube.channelHashtagSoon', 'Channel and hashtag sources — coming soon')}
      </p>
    </div>
  );
}
