import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Youtube, X as XIcon, ChevronRight } from 'lucide-react';
import { useToast } from '@/shared/lib/use-toast';
import { apiClient } from '@/shared/lib/api-client';
import { cn } from '@/shared/lib/utils';
import { useYouTubeAuth } from '@/features/youtube-sync/model/useYouTubeAuth';
import {
  useYouTubeSearch,
  type YouTubeSearchResult,
} from '@/features/youtube-sync/model/useYouTubeSync';
import { useAddLocalCard } from '@/features/card-management/model/useLocalCards';
import {
  useYouTubeSubscriptions,
  useYouTubePlaylists,
  type YouTubeSubscriptionItem,
  type YouTubePlaylistItem,
} from '@/features/youtube-sync/model/useYouTubeLibrary';
import { SearchWithChips } from './SearchWithChips';

type ModalTab = 'pl' | 'ch' | 'ht';
type FilterId = 'all' | 'registered';
type SortId = 'name' | 'videos' | 'date';

interface AddSourceModalV2Props {
  isOpen: boolean;
  onClose: () => void;
  onSourceAdded: () => void;
  registeredPlaylistIds: Set<string>;
}

export function AddSourceModalV2({
  isOpen,
  onClose,
  onSourceAdded,
  registeredPlaylistIds,
}: AddSourceModalV2Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const ytAuth = useYouTubeAuth();

  const [activeTab, setActiveTab] = useState<ModalTab>('pl');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isImporting, setIsImporting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<FilterId>('all');
  const [activeSort, setActiveSort] = useState<SortId>('name');
  const [urlExpanded, setUrlExpanded] = useState(false);
  const [playlistUrl, setPlaylistUrl] = useState('');
  const [isAddingUrl, setIsAddingUrl] = useState(false);

  // Track locally imported IDs (for instant "registered" display before refetch)
  const [localImportedIds, setLocalImportedIds] = useState<Set<string>>(new Set());

  // Hashtag state
  const [hashtagInput, setHashtagInput] = useState('');
  const [hashtagResults, setHashtagResults] = useState<YouTubeSearchResult[]>([]);
  const [addedVideoIds, setAddedVideoIds] = useState<Set<string>>(new Set());
  const youtubeSearch = useYouTubeSearch();
  const addLocalCard = useAddLocalCard();

  const subs = useYouTubeSubscriptions(ytAuth.isConnected);
  const pls = useYouTubePlaylists(ytAuth.isConnected);

  const subscriptions = subs.data?.pages.flatMap((p) => p.data) ?? [];
  const playlists = pls.data?.pages.flatMap((p) => p.data) ?? [];

  const isNotConnected =
    !ytAuth.isConnected ||
    (subs.error as { code?: string })?.code === 'YOUTUBE_NOT_CONNECTED' ||
    (pls.error as { code?: string })?.code === 'YOUTUBE_NOT_CONNECTED';

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleImport = async () => {
    if (selectedIds.size === 0) return;
    setIsImporting(true);
    let success = 0;
    let fail = 0;
    for (const id of selectedIds) {
      try {
        const url =
          activeTab === 'pl'
            ? `https://www.youtube.com/playlist?list=${id}`
            : `https://www.youtube.com/channel/${id}`;
        await apiClient.importPlaylist(url);
        success++;
        setLocalImportedIds((prev) => new Set([...prev, id]));
      } catch (err) {
        fail++;
        const msg = err instanceof Error ? err.message : 'Unknown error';
        toast({ title: msg, variant: 'destructive' });
      }
    }
    setIsImporting(false);
    setSelectedIds(new Set());
    if (success > 0) {
      toast({ title: t('youtube.importSuccess', `${success} imported`) });
      onSourceAdded();
    }
    if (fail > 0) {
      toast({ title: t('youtube.importFailed', `${fail} failed`), variant: 'destructive' });
    }
  };

  const handleAddUrl = async () => {
    const url = playlistUrl.trim();
    if (!url) return;
    setIsAddingUrl(true);
    try {
      await apiClient.importPlaylist(url);
      toast({ title: t('youtube.playlistAdded') });
      setPlaylistUrl('');
      onSourceAdded();
    } catch {
      toast({ title: t('youtube.addFailed'), variant: 'destructive' });
    } finally {
      setIsAddingUrl(false);
    }
  };

  const handleHashtagSearch = async () => {
    const q = hashtagInput.trim().replace(/^#/, '');
    if (!q) return;
    try {
      const results = await youtubeSearch.mutateAsync({ query: q, maxResults: 20 });
      setHashtagResults(results);
      setAddedVideoIds(new Set());
    } catch {
      toast({ title: t('youtube.searchFailed', 'Search failed'), variant: 'destructive' });
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
      toast({ title: t('youtube.cardAdded', 'Video added') });
    } catch {
      toast({ title: t('youtube.videoAddFailed', 'Failed to add video'), variant: 'destructive' });
    }
  };

  const handleClose = () => {
    setSelectedIds(new Set());
    setSearchQuery('');
    setActiveTab('pl');
    setUrlExpanded(false);
    setPlaylistUrl('');
    setLocalImportedIds(new Set());
    onClose();
  };

  // Build items
  const rawItems: Array<{
    id: string;
    title: string;
    subtitle: string;
    thumbnailUrl: string;
    isRegistered: boolean;
    itemCount: number;
    date: string;
  }> =
    activeTab === 'pl'
      ? playlists.map((p: YouTubePlaylistItem) => ({
          id: p.playlistId,
          title: p.title,
          subtitle: t('playlist.videoCount', { count: p.itemCount }),
          thumbnailUrl: p.thumbnailUrl,
          isRegistered:
            registeredPlaylistIds.has(p.playlistId) || localImportedIds.has(p.playlistId),
          itemCount: p.itemCount,
          date: p.publishedAt,
        }))
      : subscriptions.map((s: YouTubeSubscriptionItem) => ({
          id: s.channelId,
          title: s.title,
          subtitle: s.description.slice(0, 60) || t('youtube.channel'),
          thumbnailUrl: s.thumbnailUrl,
          isRegistered:
            registeredPlaylistIds.has(s.channelId) ||
            registeredPlaylistIds.has(s.channelId.replace(/^UC/, 'UU')) ||
            localImportedIds.has(s.channelId),
          itemCount: 0,
          date: s.publishedAt,
        }));

  // Filter
  let items = activeFilter === 'registered' ? rawItems.filter((i) => i.isRegistered) : rawItems;

  // Search
  if (searchQuery.trim()) {
    const q = searchQuery.trim().toLowerCase();
    items = items.filter((i) => i.title.toLowerCase().includes(q));
  }

  // Sort
  items = [...items].sort((a, b) => {
    if (activeSort === 'name') return a.title.localeCompare(b.title);
    if (activeSort === 'videos') return b.itemCount - a.itemCount;
    return new Date(b.date).getTime() - new Date(a.date).getTime();
  });

  const isLoading = activeTab === 'pl' ? pls.isLoading : subs.isLoading;
  const activeQuery = activeTab === 'pl' ? pls : subs;

  const FILTER_OPTIONS = [
    { id: 'all', label: t('common.all', 'All') },
    { id: 'registered', label: t('youtube.registered', 'Registered') },
  ];
  const SORT_OPTIONS = [
    { id: 'name', label: 'Name' },
    { id: 'videos', label: 'Videos' },
    { id: 'date', label: 'Date' },
  ];

  const TABS: Array<{ id: ModalTab; label: string; count: number }> = [
    { id: 'pl', label: t('youtube.tabPlaylists', 'Playlists'), count: playlists.length },
    {
      id: 'ch',
      label: t('youtube.tabSubscriptions', 'Subscriptions'),
      count: subscriptions.length,
    },
    { id: 'ht', label: t('youtube.tabHashtags', 'Hashtags'), count: 0 },
  ];

  if (!isOpen) return null;

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/55 backdrop-blur-[4px] z-[200] animate-in fade-in duration-200"
        onClick={handleClose}
      />

      {/* Modal — fixed 460×660 */}
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[460px] h-[660px] bg-surface-base border border-border rounded-[14px] z-[201] flex flex-col overflow-hidden shadow-2xl animate-in zoom-in-[0.97] fade-in duration-200">
        {/* Header */}
        <div className="px-[22px] pt-[18px] pb-[14px] flex items-center justify-between flex-shrink-0">
          <span className="text-base font-bold tracking-tight">{t('settings.addSource')}</span>
          <button
            onClick={handleClose}
            className="w-[26px] h-[26px] rounded-md flex items-center justify-center text-muted-foreground/50 hover:bg-white/[.06] hover:text-muted-foreground transition-all"
          >
            <XIcon className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex px-[22px] flex-shrink-0 border-b border-border">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id);
                setSelectedIds(new Set());
                setSearchQuery('');
              }}
              className={cn(
                'pb-2 mr-[22px] text-[13px] border-b-2 transition-all',
                activeTab === tab.id
                  ? 'text-foreground border-primary font-semibold'
                  : 'text-muted-foreground border-transparent hover:text-muted-foreground/80'
              )}
            >
              {tab.label}
              {tab.count > 0 && <span className="ml-1 opacity-60">({tab.count})</span>}
            </button>
          ))}
        </div>

        {/* Search (hidden on hashtag tab) */}
        {activeTab !== 'ht' && (
          <div className="px-[22px] pt-2.5 pb-1.5 flex-shrink-0">
            <SearchWithChips
              query={searchQuery}
              onQueryChange={setSearchQuery}
              placeholder={t('common.search', 'Search...')}
              filterOptions={FILTER_OPTIONS}
              activeFilter={activeFilter}
              onFilterChange={(id) => setActiveFilter(id as FilterId)}
              sortOptions={SORT_OPTIONS}
              activeSort={activeSort}
              onSortChange={(id) => setActiveSort(id as SortId)}
            />
          </div>
        )}

        {/* List area — the only scroll */}
        <div className="flex-1 overflow-y-auto px-[22px] py-1 scrollbar-thin">
          {activeTab === 'ht' ? (
            /* Hashtag tab — search YouTube by keyword */
            <div className="pt-3 space-y-3">
              <div className="flex gap-1.5">
                <input
                  value={hashtagInput}
                  onChange={(e) => setHashtagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleHashtagSearch();
                  }}
                  placeholder={t('youtube.hashtagPlaceholder', '#keyword (e.g. #investing, #AI)')}
                  className="flex-1 bg-surface-light border border-border rounded-[7px] px-3 py-[9px] text-[13px] text-foreground outline-none focus:border-primary"
                />
                <button
                  onClick={handleHashtagSearch}
                  disabled={youtubeSearch.isPending}
                  className="bg-surface-mid border border-border rounded-[7px] px-4 py-[9px] text-[13px] text-muted-foreground hover:border-border/80 hover:text-muted-foreground/80 transition-all disabled:opacity-40"
                >
                  {youtubeSearch.isPending ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    t('common.search', 'Search')
                  )}
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground/50">
                {t('youtube.hashtagDesc', 'Search YouTube videos by keyword and add them as cards')}
              </p>

              {/* Search results */}
              {hashtagResults.length > 0 && (
                <div className="space-y-0">
                  {hashtagResults.map((video) => (
                    <div
                      key={video.videoId}
                      className={cn(
                        'flex items-center gap-3 px-2 py-2.5 rounded-[7px] -mx-2 border-b border-white/[.03] transition-colors',
                        addedVideoIds.has(video.videoId)
                          ? 'opacity-35'
                          : 'hover:bg-white/[.025] cursor-pointer'
                      )}
                      onClick={() =>
                        !addedVideoIds.has(video.videoId) && handleAddSearchResult(video)
                      }
                    >
                      {video.thumbnail && (
                        <img
                          src={video.thumbnail}
                          alt=""
                          className="w-16 h-10 rounded-[5px] bg-surface-mid flex-shrink-0 object-cover"
                          draggable={false}
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium truncate">{video.title}</p>
                        <p className="text-[11px] text-muted-foreground/50 mt-px truncate">
                          {video.channelTitle}
                        </p>
                      </div>
                      {addedVideoIds.has(video.videoId) && (
                        <span className="text-[10px] text-green-400 font-semibold flex-shrink-0">
                          {t('youtube.registered', 'Added')}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {youtubeSearch.isPending && (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              )}
            </div>
          ) : isNotConnected ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Youtube className="w-10 h-10 text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground mb-3">{t('youtube.connectFirst')}</p>
              <button
                onClick={ytAuth.connect}
                disabled={ytAuth.isConnecting}
                className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-[7px] text-sm font-semibold flex items-center gap-1.5 transition-colors"
              >
                {ytAuth.isConnecting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Youtube className="w-3.5 h-3.5" />
                )}
                {t('youtube.connectGoogle')}
              </button>
            </div>
          ) : isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-16">
              {t('youtube.noPlaylists')}
            </p>
          ) : (
            <div className="space-y-0">
              {items.map((item) => (
                <div
                  key={item.id}
                  onClick={() => !item.isRegistered && toggleSelection(item.id)}
                  className={cn(
                    'flex items-center gap-3 px-2 py-2.5 rounded-[7px] -mx-2 cursor-pointer transition-colors border-b border-white/[.03]',
                    item.isRegistered
                      ? 'opacity-35 cursor-default'
                      : selectedIds.has(item.id)
                        ? 'bg-primary/10'
                        : 'hover:bg-white/[.025]'
                  )}
                >
                  <div
                    className={cn(
                      'w-[18px] h-[18px] border-[1.5px] rounded flex items-center justify-center flex-shrink-0 transition-all',
                      item.isRegistered
                        ? 'bg-green-400 border-green-400'
                        : selectedIds.has(item.id)
                          ? 'bg-primary border-primary'
                          : 'border-muted-foreground/40'
                    )}
                  >
                    {(item.isRegistered || selectedIds.has(item.id)) && (
                      <div className="w-[9px] h-[5px] border-l-2 border-b-2 border-white -rotate-45 -translate-y-px" />
                    )}
                  </div>
                  {item.thumbnailUrl && (
                    <img
                      src={item.thumbnailUrl}
                      alt=""
                      className="w-12 h-9 rounded-[5px] bg-surface-mid flex-shrink-0 object-cover"
                      draggable={false}
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-[13.5px] font-medium truncate">{item.title}</p>
                    <p className="text-[11px] text-muted-foreground/50 mt-px">{item.subtitle}</p>
                  </div>
                  {item.isRegistered && (
                    <span className="text-[10px] text-green-400 font-semibold flex-shrink-0">
                      {t('youtube.registered', 'Registered')}
                    </span>
                  )}
                </div>
              ))}
              {activeQuery.hasNextPage && (
                <button
                  onClick={() => activeQuery.fetchNextPage()}
                  disabled={activeQuery.isFetchingNextPage}
                  className="w-full py-2.5 text-xs text-primary hover:text-primary/80 font-medium transition-colors"
                >
                  {activeQuery.isFetchingNextPage ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin mx-auto" />
                  ) : (
                    t('youtube.loadMore', 'Load more...')
                  )}
                </button>
              )}
            </div>
          )}
        </div>

        {/* URL fold (hidden on hashtag) */}
        {activeTab !== 'ht' && (
          <div className="px-[22px] pb-1.5 flex-shrink-0">
            <button
              onClick={() => setUrlExpanded(!urlExpanded)}
              className="text-xs text-muted-foreground/50 hover:text-muted-foreground flex items-center gap-[5px] py-1.5 transition-colors"
            >
              <ChevronRight
                className={cn('w-[11px] h-[11px] transition-transform', urlExpanded && 'rotate-90')}
              />
              {t('sources.addByUrl', 'Add by URL')}
            </button>
            {urlExpanded && (
              <div className="flex gap-1.5 mt-1">
                <input
                  value={playlistUrl}
                  onChange={(e) => setPlaylistUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAddUrl();
                  }}
                  placeholder={t('youtube.playlistUrlPlaceholder')}
                  className="flex-1 bg-surface-light border border-border rounded-[7px] px-3 py-2 text-xs text-foreground outline-none focus:border-primary"
                />
                <button
                  onClick={handleAddUrl}
                  disabled={!playlistUrl.trim() || isAddingUrl}
                  className="bg-surface-mid border border-border rounded-[7px] px-3.5 py-2 text-xs text-muted-foreground hover:border-border/80 hover:text-muted-foreground/80 transition-all disabled:opacity-40"
                >
                  {isAddingUrl ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    t('common.add', 'Add')
                  )}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="px-[22px] py-[14px] border-t border-border flex items-center justify-between flex-shrink-0">
          <span className="text-[13px] text-primary font-semibold">
            {selectedIds.size > 0
              ? t('youtube.addSelected', { count: selectedIds.size })
              : t('sources.noneSelected', '0 selected')}
          </span>
          <button
            onClick={handleImport}
            disabled={selectedIds.size === 0 || isImporting}
            className="bg-primary text-white border-none rounded-[7px] px-[26px] py-[10px] text-[13.5px] font-semibold cursor-pointer transition-all hover:brightness-110 disabled:opacity-35 disabled:cursor-default tracking-tight"
          >
            {isImporting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : selectedIds.size > 0 ? (
              t('youtube.addSelectedBtn', `Add ${selectedIds.size}`)
            ) : (
              t('common.add', 'Add')
            )}
          </button>
        </div>
      </div>
    </>
  );
}
