import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { Plus, RefreshCw, Loader2 } from 'lucide-react';
import { useYouTubeSync } from '@/features/youtube-sync/model/useYouTubeSync';
import { SourceCard } from './SourceCard';
import { AddSourceModal } from './AddSourceModal';
import { cn } from '@/shared/lib/utils';

type FilterType = 'all' | 'playlist' | 'channel' | 'hashtag';

export function SourceManagementTab() {
  const { t } = useTranslation();
  const ytSync = useYouTubeSync();
  const [filter, setFilter] = useState<FilterType>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [syncingIds, setSyncingIds] = useState<Set<string>>(new Set());
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());

  const playlists = ytSync.playlists ?? [];
  const isLoading = ytSync.isLoading;

  // Map playlists to source format
  const sources = playlists.map((p) => ({
    id: p.id,
    name: p.title || t('playlist.noTitle'),
    type: 'playlist' as const,
    videoCount: p.item_count ?? 0,
    lastSyncedAt: p.last_synced_at?.toString() ?? null,
    youtubeUrl: p.youtube_playlist_url ?? undefined,
  }));

  // Filter
  const filtered = filter === 'all' ? sources : sources.filter((s) => s.type === filter);

  // Counts
  const counts: Record<FilterType, number> = {
    all: sources.length,
    playlist: sources.filter((s) => s.type === 'playlist').length,
    channel: 0,
    hashtag: 0,
  };

  const handleSync = async (id: string) => {
    setSyncingIds((prev) => new Set(prev).add(id));
    try {
      await ytSync.syncPlaylist(id);
    } finally {
      setSyncingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingIds((prev) => new Set(prev).add(id));
    try {
      await ytSync.deletePlaylist(id);
    } finally {
      setDeletingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleSyncAll = async () => {
    for (const source of filtered) {
      await handleSync(source.id);
    }
  };

  const FILTERS: { id: FilterType; labelKey: string }[] = [
    { id: 'all', labelKey: 'common.all' },
    { id: 'playlist', labelKey: 'sources.youtube.playlist' },
    { id: 'channel', labelKey: 'sources.youtube.channel' },
    { id: 'hashtag', labelKey: 'sources.youtube.hashtag' },
  ];

  return (
    <div className="space-y-4">
      {/* Header: Add Source button */}
      <div className="flex items-center justify-end">
        <Button size="sm" className="gap-1.5" onClick={() => setIsModalOpen(true)}>
          <Plus className="w-3.5 h-3.5" />
          {t('settings.addSource')}
        </Button>
      </div>

      {/* Filter chips */}
      {sources.length > 0 && (
        <div className="flex items-center gap-1.5">
          {FILTERS.map(({ id, labelKey }) => (
            <button
              key={id}
              onClick={() => setFilter(id)}
              className={cn(
                'px-3 py-1 rounded-full text-xs font-medium transition-colors',
                filter === id
                  ? 'bg-primary/10 text-primary border border-primary/30'
                  : 'bg-surface-light text-muted-foreground hover:text-foreground border border-transparent'
              )}
            >
              {t(labelKey)} {counts[id]}
            </button>
          ))}
        </div>
      )}

      {/* Source list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p className="text-sm">{t('settings.noSources', 'No registered sources')}</p>
          <p className="text-xs mt-1">
            {t('settings.noSourcesHint', 'Add a source to get started')}
          </p>
        </div>
      ) : (
        <div className="space-y-2 max-h-[480px] overflow-y-auto pb-2">
          {filtered.map((source) => (
            <SourceCard
              key={source.id}
              name={source.name}
              type={source.type}
              videoCount={source.videoCount}
              lastSyncedAt={source.lastSyncedAt}
              youtubeUrl={source.youtubeUrl}
              onSync={() => handleSync(source.id)}
              onDelete={() => handleDelete(source.id)}
              isSyncing={syncingIds.has(source.id)}
              isDeleting={deletingIds.has(source.id)}
            />
          ))}
        </div>
      )}

      {/* Sync All */}
      {filtered.length > 0 && (
        <div className="flex justify-center pt-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={handleSyncAll}>
            <RefreshCw className="w-3.5 h-3.5" />
            {t('settings.syncAll', 'Sync All')}
          </Button>
        </div>
      )}

      {/* Add Source Modal */}
      <AddSourceModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSourceAdded={() => ytSync.refetch?.()}
      />
    </div>
  );
}
