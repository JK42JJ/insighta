import { useState, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Search, Check, ChevronsUpDown, LayoutGrid, Plus, RefreshCw } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { Popover, PopoverTrigger, PopoverContent } from '@/shared/ui/popover';
import { ScrollArea } from '@/shared/ui/scroll-area';
import { useMandalaList } from '@/features/mandala';

interface SidebarMandalaSectionProps {
  collapsed: boolean;
  mandalaGridElement?: React.ReactNode;
  selectedMandalaId: string | null;
  onMandalaSelect: (id: string) => void;
}

type SortOption = 'recent' | 'az';

export function SidebarMandalaSection({
  collapsed,
  mandalaGridElement,
  selectedMandalaId,
  onMandalaSelect,
}: SidebarMandalaSectionProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: listData, isLoading, isError, error, refetch } = useMandalaList();

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('recent');
  const [loadingTooLong, setLoadingTooLong] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // 10s loading timeout — show retry instead of infinite skeleton
  useEffect(() => {
    if (!isLoading) {
      setLoadingTooLong(false);
      return;
    }
    const timer = setTimeout(() => setLoadingTooLong(true), 10_000);
    return () => clearTimeout(timer);
  }, [isLoading]);

  const mandalas = listData?.mandalas ?? [];

  const selectedMandala = mandalas.find((m) => m.id === selectedMandalaId);

  const filtered = useMemo(() => {
    if (!search) return mandalas;
    const q = search.toLowerCase();
    return mandalas.filter((m) => m.title.toLowerCase().includes(q));
  }, [mandalas, search]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    if (sortBy === 'az') {
      return list.sort((a, b) => a.title.localeCompare(b.title));
    }
    return list.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }, [filtered, sortBy]);

  // Auto-focus search input when popover opens
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  const handleSelect = (id: string) => {
    onMandalaSelect(id);
    setOpen(false);
    setSearch('');
  };

  // Collapsed sidebar: icon button only
  if (collapsed) {
    return (
      <div className="px-2 py-1">
        <button
          className="w-full flex items-center justify-center px-2 py-2.5 rounded-lg text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
          title={t('sidebar.mandalas')}
          onClick={() => navigate('/')}
        >
          <LayoutGrid className="w-5 h-5" />
        </button>
      </div>
    );
  }

  // Loading state (with 10s timeout → retry)
  if (isLoading) {
    return (
      <div className="px-2 space-y-0.5">
        <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/40">
          {t('sidebar.mandalas')}
        </div>
        {loadingTooLong ? (
          <button
            onClick={() => refetch()}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent rounded-lg transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            {t('common.loadFailed')}
          </button>
        ) : (
          <div className="px-3 py-2 animate-pulse">
            <div className="h-4 bg-sidebar-accent/30 rounded w-3/4" />
          </div>
        )}
      </div>
    );
  }

  // Error state
  if (isError) {
    if (error) console.warn('[SidebarMandalaSection] Failed to load mandalas:', error);

    return (
      <div className="px-2 space-y-0.5">
        <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/40">
          {t('sidebar.mandalas')}
        </div>
        <button
          onClick={() => refetch()}
          className="w-full flex items-center gap-2 px-3 py-2 text-xs text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent rounded-lg transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          {t('common.loadFailed')}
        </button>
      </div>
    );
  }

  // Empty state
  if (mandalas.length === 0) {
    return (
      <div className="px-2 space-y-0.5">
        <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/40">
          {t('sidebar.mandalas')}
        </div>
        <button
          onClick={() => navigate('/mandala-settings')}
          className="w-full flex items-center gap-2 px-3 py-2 text-xs text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent rounded-lg transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          {t('mandalaSettings.createNew')}
        </button>
      </div>
    );
  }

  return (
    <div className="px-2 space-y-1.5">
      <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/40">
        {t('sidebar.mandalas')}
      </div>

      {/* Searchable dropdown trigger */}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            className={cn(
              'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200',
              'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
              'bg-sidebar-accent/50 text-sidebar-foreground'
            )}
          >
            <LayoutGrid className="w-4 h-4 shrink-0" />
            <span className="flex-1 text-left truncate">
              {selectedMandala?.title ?? t('sidebar.selectMandala', 'Select mandala')}
            </span>
            <ChevronsUpDown className="w-3.5 h-3.5 shrink-0 text-sidebar-foreground/50" />
          </button>
        </PopoverTrigger>

        <PopoverContent
          className="w-[var(--radix-popover-trigger-width)] p-0"
          align="start"
          sideOffset={4}
        >
          {/* Search input */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border/30">
            <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <input
              ref={inputRef}
              type="text"
              placeholder={t('sidebar.searchMandalas', 'Search mandalas...')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
            />
          </div>

          {/* Sort filter */}
          <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border/20">
            <button
              onClick={() => setSortBy('recent')}
              className={cn(
                'px-2 py-0.5 rounded text-[11px] font-medium transition-colors',
                sortBy === 'recent'
                  ? 'bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {t('sidebar.sortRecent', 'Recently added')}
            </button>
            <button
              onClick={() => setSortBy('az')}
              className={cn(
                'px-2 py-0.5 rounded text-[11px] font-medium transition-colors',
                sortBy === 'az'
                  ? 'bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              A-Z
            </button>
          </div>

          {/* Mandala list */}
          <ScrollArea className="max-h-[240px]">
            <div className="py-1">
              {sorted.length === 0 ? (
                <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                  {t('sidebar.noResults', 'No results')}
                </div>
              ) : (
                sorted.map((mandala) => (
                  <button
                    key={mandala.id}
                    onClick={() => handleSelect(mandala.id)}
                    className={cn(
                      'w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors',
                      'hover:bg-accent hover:text-accent-foreground',
                      mandala.id === selectedMandalaId && 'bg-accent/50'
                    )}
                  >
                    {mandala.id === selectedMandalaId ? (
                      <Check className="w-3.5 h-3.5 shrink-0 text-primary" />
                    ) : (
                      <span className="w-3.5 h-3.5 shrink-0" />
                    )}
                    <span className="flex-1 text-left truncate">{mandala.title}</span>
                  </button>
                ))
              )}
            </div>
          </ScrollArea>

          {/* Create New Mandala */}
          <div className="border-t border-border/30">
            <button
              onClick={() => {
                setOpen(false);
                navigate('/mandala-settings');
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              <Plus className="w-3.5 h-3.5 shrink-0" />
              {t('mandalaSettings.createNew')}
            </button>
          </div>
        </PopoverContent>
      </Popover>

      {/* Mandala grid — always visible for selected mandala */}
      {mandalaGridElement && (
        <div
          className="rounded-lg overflow-hidden bg-surface-base/50 border border-border/20"
          style={{ containerType: 'inline-size' }}
        >
          <div className="w-full aspect-square flex items-center justify-center p-1">
            {mandalaGridElement}
          </div>
        </div>
      )}
    </div>
  );
}
