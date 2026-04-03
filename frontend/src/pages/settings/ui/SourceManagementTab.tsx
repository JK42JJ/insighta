import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { Plus, RefreshCw, Loader2, Search, ChevronDown } from 'lucide-react';
import { useYouTubeSync } from '@/features/youtube-sync/model/useYouTubeSync';
import {
  useMandalaList,
  useSourceMappings,
  useCreateSourceMappings,
  useDeleteSourceMapping,
} from '@/features/mandala';
import { apiClient } from '@/shared/lib/api-client';
import { SourceCard } from './SourceCard';
import { AddSourceModal } from './AddSourceModal';
import { cn } from '@/shared/lib/utils';

type FilterType = 'all' | 'playlist' | 'channel' | 'hashtag';
type SortType = 'name' | 'date' | 'videos';

export function SourceManagementTab() {
  const { t } = useTranslation();
  const ytSync = useYouTubeSync();
  const [filter, setFilter] = useState<FilterType>('all');
  const [mandalaFilter, setMandalaFilter] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [syncingIds, setSyncingIds] = useState<Set<string>>(new Set());
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [pausingIds, setPausingIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortType>('name');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkMandala, setShowBulkMandala] = useState(false);
  const bulkDropdownRef = useRef<HTMLDivElement>(null);

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

  // Close bulk dropdown on outside click
  useEffect(() => {
    if (!showBulkMandala) return;
    const handler = (e: MouseEvent) => {
      if (bulkDropdownRef.current && !bulkDropdownRef.current.contains(e.target as Node)) {
        setShowBulkMandala(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showBulkMandala]);

  // Build lookup: youtube_playlist_id -> mandala labels
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
    if (labels.length === 0) {
      unmappedCount++;
    }
    for (const l of labels) {
      if (!mandalaFilterCounts[l.mandalaId]) {
        mandalaFilterCounts[l.mandalaId] = { id: l.mandalaId, title: l.title, count: 0 };
      }
      mandalaFilterCounts[l.mandalaId].count++;
    }
    return {
      id: p.id,
      name: p.title || t('playlist.noTitle'),
      type: 'playlist' as const,
      videoCount: p.item_count ?? 0,
      isPaused: p.is_paused ?? false,
      lastSyncedAt: p.last_synced_at?.toString() ?? null,
      youtubeUrl: p.youtube_playlist_url ?? undefined,
      youtubePlaylistId: ytId,
      createdAt: p.created_at,
    };
  });

  // Apply filters
  let filtered = filter === 'all' ? sources : sources.filter((s) => s.type === filter);

  // A-4: Mandala filter
  if (mandalaFilter === '__ai__') {
    filtered = filtered.filter(
      (s) => (sourceMappingLookup[s.youtubePlaylistId] ?? []).length === 0
    );
  } else if (mandalaFilter) {
    filtered = filtered.filter((s) =>
      (sourceMappingLookup[s.youtubePlaylistId] ?? []).some((l) => l.mandalaId === mandalaFilter)
    );
  }

  // A-3: Search
  if (searchQuery.trim()) {
    const q = searchQuery.trim().toLowerCase();
    filtered = filtered.filter((s) => s.name.toLowerCase().includes(q));
  }

  // A-3: Sort
  filtered = [...filtered].sort((a, b) => {
    if (sortBy === 'name') return a.name.localeCompare(b.name);
    if (sortBy === 'videos') return b.videoCount - a.videoCount;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  // Counts
  const counts: Record<FilterType, number> = {
    all: sources.length,
    playlist: sources.filter((s) => s.type === 'playlist').length,
    channel: 0,
    hashtag: 0,
  };

  // A-2: Toggle source selection
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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

  const handlePause = async (id: string) => {
    setPausingIds((prev) => new Set(prev).add(id));
    try {
      await ytSync.pausePlaylist(id);
    } finally {
      setPausingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleResume = async (id: string) => {
    setPausingIds((prev) => new Set(prev).add(id));
    try {
      await ytSync.resumePlaylist(id);
    } finally {
      setPausingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleRemoveLabel = async (sourceYoutubeId: string, mandalaId: string) => {
    const sourceType = sourceYoutubeId.startsWith('UU') ? 'channel' : 'playlist';
    try {
      await deleteSourceMapping.mutateAsync({ sourceType, sourceId: sourceYoutubeId, mandalaId });
    } catch {
      // silent
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
      // silent
    }
  };

  // A-1: Rename
  const handleRename = async (id: string, newName: string) => {
    try {
      await apiClient.updatePlaylist(id, { title: newName });
      ytSync.refetch?.();
    } catch {
      // silent
    }
  };

  // A-2: Bulk assign mandala
  const handleBulkAssignMandala = async (mandalaId: string) => {
    const selectedSources = sources.filter((s) => selectedIds.has(s.id));
    const sourceIds = selectedSources.map((s) => s.youtubePlaylistId);
    if (sourceIds.length === 0) return;
    try {
      await createSourceMappings.mutateAsync({
        sourceType: 'playlist',
        sourceIds,
        mandalaId,
      });
    } catch {
      // silent
    }
    setSelectedIds(new Set());
    setShowBulkMandala(false);
  };

  const handleSyncAll = async () => {
    const activeSources = filtered.filter((s) => !s.isPaused);
    for (const source of activeSources) {
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
      {/* Header: Search + Add Source */}
      <div className="flex items-center gap-2">
        {/* A-3: Search */}
        {sources.length > 4 && (
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('settings.searchSources', 'Search sources...')}
              className="w-full pl-8 pr-3 py-1.5 text-sm bg-surface-light border border-border/50 rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
            />
          </div>
        )}
        <div className="flex items-center gap-1.5 ml-auto">
          {/* A-3: Sort */}
          {sources.length > 4 && (
            <div className="flex items-center gap-0.5">
              {(['name', 'date', 'videos'] as SortType[]).map((opt) => (
                <button
                  key={opt}
                  onClick={() => setSortBy(opt)}
                  className={cn(
                    'px-2 py-1 rounded text-[10px] font-medium transition-colors',
                    sortBy === opt
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {opt === 'name' && t('common.name', 'Name')}
                  {opt === 'date' && t('common.date', 'Date')}
                  {opt === 'videos' && t('common.videos', 'Videos')}
                </button>
              ))}
            </div>
          )}
          <Button size="sm" className="gap-1.5" onClick={() => setIsModalOpen(true)}>
            <Plus className="w-3.5 h-3.5" />
            {t('settings.addSource')}
          </Button>
        </div>
      </div>

      {/* Type filter chips */}
      {sources.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
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

      {/* A-4: Mandala filter chips */}
      {(Object.keys(mandalaFilterCounts).length > 0 || unmappedCount > 0) && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            onClick={() => setMandalaFilter(null)}
            className={cn(
              'px-2.5 py-0.5 rounded-full text-[11px] font-medium transition-colors',
              mandalaFilter === null
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {t('common.all', 'All')}
          </button>
          {Object.values(mandalaFilterCounts).map((m) => (
            <button
              key={m.id}
              onClick={() => setMandalaFilter(m.id === mandalaFilter ? null : m.id)}
              className={cn(
                'px-2.5 py-0.5 rounded-full text-[11px] font-medium transition-colors',
                mandalaFilter === m.id
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {m.title} ({m.count})
            </button>
          ))}
          {unmappedCount > 0 && (
            <button
              onClick={() => setMandalaFilter(mandalaFilter === '__ai__' ? null : '__ai__')}
              className={cn(
                'px-2.5 py-0.5 rounded-full text-[11px] font-medium transition-colors',
                mandalaFilter === '__ai__'
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              AI ({unmappedCount})
            </button>
          )}
        </div>
      )}

      {/* A-2: Bulk actions toolbar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-surface-light/50 border border-border/30">
          <span className="text-xs text-muted-foreground">
            {t('sources.selectedCount', { count: selectedIds.size })}
          </span>
          <div className="relative" ref={bulkDropdownRef}>
            <button
              onClick={() => setShowBulkMandala(!showBulkMandala)}
              className="text-xs font-medium text-primary border border-primary/30 bg-primary/5 hover:bg-primary/10 px-3 py-1 rounded-md transition-colors flex items-center gap-1.5"
            >
              {t('sources.bulkAssign', 'Assign Mandala')}
              <ChevronDown
                className={cn('w-3 h-3 transition-transform', showBulkMandala && 'rotate-180')}
              />
            </button>
            {showBulkMandala && (
              <div className="absolute left-0 top-full mt-1 w-56 bg-surface-mid border border-border rounded-lg shadow-lg z-50 py-1 max-h-48 overflow-y-auto">
                {mandalaOptions.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => handleBulkAssignMandala(m.id)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50 transition-colors truncate"
                  >
                    {m.title}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="text-xs text-muted-foreground hover:text-foreground ml-auto"
          >
            {t('common.cancel')}
          </button>
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
            <div key={source.id} className="flex items-start gap-2">
              {/* A-2: Checkbox for bulk select */}
              <input
                type="checkbox"
                checked={selectedIds.has(source.id)}
                onChange={() => toggleSelect(source.id)}
                className="w-3.5 h-3.5 mt-4 rounded border-border accent-primary shrink-0"
              />
              <div className="flex-1 min-w-0">
                <SourceCard
                  name={source.name}
                  type={source.type}
                  videoCount={source.videoCount}
                  lastSyncedAt={source.lastSyncedAt}
                  createdAt={source.createdAt}
                  youtubeUrl={source.youtubeUrl}
                  isPaused={source.isPaused}
                  mandalaLabels={sourceMappingLookup[source.youtubePlaylistId] ?? []}
                  mandalaOptions={mandalaOptions}
                  onSync={() => handleSync(source.id)}
                  onPause={() => handlePause(source.id)}
                  onResume={() => handleResume(source.id)}
                  onDelete={() => handleDelete(source.id)}
                  onRemoveLabel={(mandalaId) =>
                    handleRemoveLabel(source.youtubePlaylistId, mandalaId)
                  }
                  onAddLabel={(mandalaId) => handleAddLabel(source.youtubePlaylistId, mandalaId)}
                  onRename={(newName) => handleRename(source.id, newName)}
                  isSyncing={syncingIds.has(source.id)}
                  isPausing={pausingIds.has(source.id)}
                  isDeleting={deletingIds.has(source.id)}
                />
              </div>
            </div>
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
