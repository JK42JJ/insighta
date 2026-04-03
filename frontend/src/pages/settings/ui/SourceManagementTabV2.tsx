import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, Loader2 } from 'lucide-react';
import { useYouTubeSync } from '@/features/youtube-sync/model/useYouTubeSync';
import {
  useMandalaList,
  useSourceMappings,
  useCreateSourceMappings,
  useDeleteSourceMapping,
} from '@/features/mandala';
import { SourceCardV2 } from './SourceCardV2';
import { AddSourceModalV2 } from './AddSourceModalV2';
import { BulkActionBar } from './BulkActionBar';
import { SearchWithChips } from './SearchWithChips';
import { cn } from '@/shared/lib/utils';

type FilterType = 'all' | 'playlist' | 'channel' | 'hashtag';
type FilterId = 'all' | 'registered';
type SortId = 'name' | 'videos' | 'date';

export function SourceManagementTabV2() {
  const { t } = useTranslation();
  const ytSync = useYouTubeSync();

  const [typeFilter, setTypeFilter] = useState<FilterType>('all');
  const [mandalaFilter, setMandalaFilter] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [syncingIds, setSyncingIds] = useState<Set<string>>(new Set());
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [pausingIds, setPausingIds] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFilter, setSearchFilter] = useState<FilterId>('all');
  const [searchSort, setSearchSort] = useState<SortId>('name');
  const [isSyncingAll, setIsSyncingAll] = useState(false);

  const playlists = ytSync.playlists ?? [];
  const isLoading = ytSync.isLoading;
  const { data: sourceMappingsData } = useSourceMappings();
  const { data: mandalaListData } = useMandalaList();
  const mandalaOptions = (mandalaListData?.mandalas ?? []).map((m) => ({
    id: m.id,
    title: m.title,
  }));
  const createSourceMappings = useCreateSourceMappings();
  const deleteSourceMapping = useDeleteSourceMapping();

  // Build source mapping lookup
  const sourceMappingLookup: Record<string, Array<{ mandalaId: string; title: string }>> = {};
  for (const m of sourceMappingsData?.mappings ?? []) {
    if (!sourceMappingLookup[m.source_id]) sourceMappingLookup[m.source_id] = [];
    sourceMappingLookup[m.source_id].push({ mandalaId: m.mandala_id, title: m.mandala.title });
  }

  // Build mandala filter counts
  const mandalaFilterCounts: Record<string, { id: string; title: string; count: number }> = {};
  let unmappedCount = 0;

  const sources = playlists.map((p) => {
    const ytId = p.youtube_playlist_id;
    const labels = sourceMappingLookup[ytId] ?? [];
    if (labels.length === 0) unmappedCount++;
    for (const l of labels) {
      if (!mandalaFilterCounts[l.mandalaId]) {
        mandalaFilterCounts[l.mandalaId] = { id: l.mandalaId, title: l.title, count: 0 };
      }
      mandalaFilterCounts[l.mandalaId].count++;
    }
    return {
      id: p.id,
      name: p.title || t('playlist.noTitle'),
      type: (ytId.startsWith('UU') ? 'channel' : 'playlist') as 'playlist' | 'channel' | 'hashtag',
      videoCount: p.item_count ?? 0,
      isPaused: p.is_paused ?? false,
      lastSyncedAt: p.last_synced_at?.toString() ?? null,
      youtubeUrl: p.youtube_playlist_url ?? undefined,
      youtubePlaylistId: ytId,
      createdAt: p.created_at,
    };
  });

  const registeredPlaylistIds = new Set(playlists.map((p) => p.youtube_playlist_id));

  // Apply type filter
  let filtered = typeFilter === 'all' ? sources : sources.filter((s) => s.type === typeFilter);

  // Apply mandala filter
  if (mandalaFilter === '__ai__') {
    filtered = filtered.filter(
      (s) => (sourceMappingLookup[s.youtubePlaylistId] ?? []).length === 0
    );
  } else if (mandalaFilter) {
    filtered = filtered.filter((s) =>
      (sourceMappingLookup[s.youtubePlaylistId] ?? []).some((l) => l.mandalaId === mandalaFilter)
    );
  }

  // Apply search filter (registered only)
  if (searchFilter === 'registered') {
    // already all registered since they come from playlists
  }

  // Apply search query
  if (searchQuery.trim()) {
    const q = searchQuery.trim().toLowerCase();
    filtered = filtered.filter((s) => s.name.toLowerCase().includes(q));
  }

  // Sort
  filtered = [...filtered].sort((a, b) => {
    if (searchSort === 'name') return a.name.localeCompare(b.name);
    if (searchSort === 'videos') return b.videoCount - a.videoCount;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const counts: Record<FilterType, number> = {
    all: sources.length,
    playlist: sources.filter((s) => s.type === 'playlist').length,
    channel: sources.filter((s) => s.type === 'channel').length,
    hashtag: sources.filter((s) => s.type === 'hashtag').length,
  };

  // Selection
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allSelected = filtered.length > 0 && filtered.every((s) => selectedIds.has(s.id));

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((s) => s.id)));
    }
  };

  // Handlers
  const handleSync = async (id: string) => {
    setSyncingIds((prev) => new Set(prev).add(id));
    try {
      await ytSync.syncPlaylist(id);
    } finally {
      setSyncingIds((prev) => {
        const n = new Set(prev);
        n.delete(id);
        return n;
      });
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingIds((prev) => new Set(prev).add(id));
    try {
      await ytSync.deletePlaylist(id);
    } finally {
      setDeletingIds((prev) => {
        const n = new Set(prev);
        n.delete(id);
        return n;
      });
    }
  };

  const handlePause = async (id: string) => {
    setPausingIds((prev) => new Set(prev).add(id));
    try {
      await ytSync.pausePlaylist(id);
      ytSync.refetch?.();
    } finally {
      setPausingIds((prev) => {
        const n = new Set(prev);
        n.delete(id);
        return n;
      });
    }
  };

  const handleResume = async (id: string) => {
    setPausingIds((prev) => new Set(prev).add(id));
    try {
      await ytSync.resumePlaylist(id);
      ytSync.refetch?.();
    } finally {
      setPausingIds((prev) => {
        const n = new Set(prev);
        n.delete(id);
        return n;
      });
    }
  };

  const handleRemoveLabel = async (sourceYoutubeId: string, mandalaId: string) => {
    const sourceType = sourceYoutubeId.startsWith('UU') ? 'channel' : 'playlist';
    try {
      await deleteSourceMapping.mutateAsync({ sourceType, sourceId: sourceYoutubeId, mandalaId });
    } catch {
      /* silent */
    }
  };

  const handleAddLabel = async (sourceYoutubeId: string, mandalaId: string) => {
    const sourceType = sourceYoutubeId.startsWith('UU') ? 'channel' : 'playlist';
    try {
      await createSourceMappings.mutateAsync({
        sourceType,
        sourceIds: [sourceYoutubeId],
        mandalaId,
      });
    } catch {
      /* silent */
    }
  };

  // Bulk
  const handleBulkAssignMandala = async (mandalaId: string) => {
    const ids = sources.filter((s) => selectedIds.has(s.id)).map((s) => s.youtubePlaylistId);
    if (ids.length === 0) return;
    try {
      await createSourceMappings.mutateAsync({ sourceType: 'playlist', sourceIds: ids, mandalaId });
    } catch {
      /* silent */
    }
    setSelectedIds(new Set());
  };

  const handleBulkPause = async () => {
    const targets = sources.filter((s) => selectedIds.has(s.id) && !s.isPaused);
    for (const s of targets) {
      await handlePause(s.id);
    }
    setSelectedIds(new Set());
  };

  const handleBulkDelete = async () => {
    for (const s of sources.filter((s) => selectedIds.has(s.id))) {
      await handleDelete(s.id);
    }
    setSelectedIds(new Set());
  };

  const handleSyncAll = async () => {
    setIsSyncingAll(true);
    const active = filtered.filter((s) => !s.isPaused);
    for (const s of active) {
      await handleSync(s.id);
    }
    setIsSyncingAll(false);
  };

  const FILTER_OPTIONS = [
    { id: 'all', label: t('common.all', 'All') },
    { id: 'registered', label: t('youtube.registered', 'Registered') },
  ];
  const SORT_OPTIONS = [
    { id: 'name', label: 'Name' },
    { id: 'videos', label: 'Videos' },
    { id: 'date', label: 'Date' },
  ];
  const TYPE_FILTERS: Array<{ id: FilterType; label: string }> = [
    { id: 'all', label: `${t('common.all')} ${counts.all}` },
    { id: 'playlist', label: `${t('sources.youtube.playlist')} ${counts.playlist}` },
    { id: 'channel', label: `${t('sources.youtube.channel')} ${counts.channel}` },
    { id: 'hashtag', label: `${t('sources.youtube.hashtag')} ${counts.hashtag}` },
  ];

  return (
    <div className="space-y-3.5">
      {/* Toolbar: Search + Add Source */}
      <div className="flex items-center gap-2.5">
        <SearchWithChips
          query={searchQuery}
          onQueryChange={setSearchQuery}
          placeholder={t('settings.searchSources', 'Search sources...')}
          filterOptions={FILTER_OPTIONS}
          activeFilter={searchFilter}
          onFilterChange={(id) => setSearchFilter(id as FilterId)}
          sortOptions={SORT_OPTIONS}
          activeSort={searchSort}
          onSortChange={(id) => setSearchSort(id as SortId)}
        />
        <button
          onClick={() => setIsModalOpen(true)}
          className="bg-primary text-white border-none rounded-[7px] px-5 py-[9px] text-[13px] font-semibold cursor-pointer whitespace-nowrap transition-all hover:brightness-110 tracking-tight"
        >
          + {t('settings.addSource')}
        </button>
      </div>

      {/* Type filter chips */}
      {sources.length > 0 && (
        <div className="flex gap-1.5 flex-wrap">
          {TYPE_FILTERS.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setTypeFilter(id)}
              className={cn(
                'px-[13px] py-1 rounded-full text-xs cursor-pointer transition-all border select-none',
                typeFilter === id
                  ? 'bg-primary/10 border-primary/30 text-primary font-semibold'
                  : 'border-border text-muted-foreground hover:border-border/80 hover:text-muted-foreground/80'
              )}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Mandala filter links + Select all */}
      {(Object.keys(mandalaFilterCounts).length > 0 || unmappedCount > 0) && (
        <div className="flex items-center justify-between py-0.5 gap-4">
          <div className="flex gap-[18px] overflow-x-auto whitespace-nowrap flex-1 min-w-0 scrollbar-thin">
            <button
              onClick={() => setMandalaFilter(null)}
              className={cn(
                'text-xs transition-colors',
                mandalaFilter === null
                  ? 'text-primary font-semibold'
                  : 'text-muted-foreground hover:text-muted-foreground/80'
              )}
            >
              #{t('settings.mandalas', 'Mandala')}
            </button>
            {Object.values(mandalaFilterCounts).map((m) => (
              <button
                key={m.id}
                onClick={() => setMandalaFilter(m.id === mandalaFilter ? null : m.id)}
                className={cn(
                  'text-xs transition-colors',
                  mandalaFilter === m.id
                    ? 'text-primary font-semibold'
                    : 'text-muted-foreground hover:text-muted-foreground/80'
                )}
              >
                <span className="max-w-[120px] truncate inline-block align-bottom">#{m.title}</span>
                ({m.count})
              </button>
            ))}
            {unmappedCount > 0 && (
              <button
                onClick={() => setMandalaFilter(mandalaFilter === '__ai__' ? null : '__ai__')}
                className={cn(
                  'text-xs transition-colors',
                  mandalaFilter === '__ai__'
                    ? 'text-primary font-semibold'
                    : 'text-muted-foreground hover:text-muted-foreground/80'
                )}
              >
                #AI({unmappedCount})
              </button>
            )}
          </div>
          <button
            onClick={toggleSelectAll}
            className="text-xs text-muted-foreground hover:text-muted-foreground/80 cursor-pointer transition-colors"
          >
            {allSelected
              ? t('sources.deselectAll', 'Deselect all')
              : t('sources.selectAll', 'Select all')}
          </button>
        </div>
      )}

      {/* Source cards */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <p className="text-sm">{t('settings.noSources', 'No registered sources')}</p>
          <p className="text-xs mt-1">
            {t('settings.noSourcesHint', 'Add a source to get started')}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5 mb-4.5">
          {filtered.map((source) => (
            <SourceCardV2
              key={source.id}
              id={source.id}
              name={source.name}
              type={source.type}
              videoCount={source.videoCount}
              lastSyncedAt={source.lastSyncedAt}
              youtubeUrl={source.youtubeUrl}
              isPaused={source.isPaused}
              isSelected={selectedIds.has(source.id)}
              mandalaLabels={sourceMappingLookup[source.youtubePlaylistId] ?? []}
              mandalaOptions={mandalaOptions}
              onSelect={() => toggleSelect(source.id)}
              onSync={() => handleSync(source.id)}
              onPause={() => handlePause(source.id)}
              onResume={() => handleResume(source.id)}
              onDelete={() => handleDelete(source.id)}
              onRemoveLabel={(mandalaId) => handleRemoveLabel(source.youtubePlaylistId, mandalaId)}
              onAddLabel={(mandalaId) => handleAddLabel(source.youtubePlaylistId, mandalaId)}
              isSyncing={syncingIds.has(source.id)}
              isPausing={pausingIds.has(source.id)}
              isDeleting={deletingIds.has(source.id)}
            />
          ))}
        </div>
      )}

      {/* Sync All */}
      {filtered.length > 0 && (
        <div className="flex justify-center mt-3.5">
          <button
            onClick={handleSyncAll}
            disabled={isSyncingAll}
            className="bg-surface-mid border border-border text-muted-foreground px-[22px] py-2 rounded-[7px] text-xs cursor-pointer transition-all flex items-center gap-1.5 hover:border-border/80 hover:text-muted-foreground/80 disabled:opacity-50"
          >
            {isSyncingAll ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            {t('settings.syncAll', 'Sync All')}
          </button>
        </div>
      )}

      {/* Bulk action bar */}
      <BulkActionBar
        count={selectedIds.size}
        mandalaOptions={mandalaOptions}
        onAssignMandala={handleBulkAssignMandala}
        onPause={handleBulkPause}
        onDelete={handleBulkDelete}
        onCancel={() => setSelectedIds(new Set())}
      />

      {/* Add Source Modal */}
      <AddSourceModalV2
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSourceAdded={() => ytSync.refetch?.()}
        registeredPlaylistIds={registeredPlaylistIds}
      />
    </div>
  );
}
