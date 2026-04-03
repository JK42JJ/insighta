import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  Loader2,
  RefreshCw,
  Trash2,
  ExternalLink,
  ListVideo,
  Tv,
  Hash,
  Pause,
  Play,
  Plus,
  ChevronDown,
  Copy,
  Check,
} from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { ko, enUS } from 'date-fns/locale';

type SourceType = 'playlist' | 'channel' | 'hashtag';

const PORTAL_DROPDOWN_Z_INDEX = 9999;

const TYPE_ICONS: Record<SourceType, React.ComponentType<{ className?: string }>> = {
  playlist: ListVideo,
  channel: Tv,
  hashtag: Hash,
};

interface MandalaLabel {
  mandalaId: string;
  title: string;
}

interface MandalaOption {
  id: string;
  title: string;
}

interface SourceCardV2Props {
  id: string;
  name: string;
  type: SourceType;
  videoCount: number;
  lastSyncedAt: string | null;
  youtubeUrl?: string;
  isPaused: boolean;
  isSelected: boolean;
  mandalaLabels: MandalaLabel[];
  mandalaOptions: MandalaOption[];
  onSelect: () => void;
  onSync: () => void;
  onPause: () => void;
  onResume: () => void;
  onDelete: () => void;
  onRemoveLabel: (mandalaId: string) => void;
  onAddLabel: (mandalaId: string) => void;
  isSyncing: boolean;
  isPausing: boolean;
  isDeleting: boolean;
}

export function SourceCardV2({
  name,
  type,
  videoCount,
  lastSyncedAt,
  youtubeUrl,
  isPaused,
  isSelected,
  mandalaLabels,
  mandalaOptions,
  onSelect,
  onSync,
  onPause,
  onResume,
  onDelete,
  onRemoveLabel,
  onAddLabel,
  isSyncing,
  isPausing,
  isDeleting,
}: SourceCardV2Props) {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language.startsWith('ko') ? ko : enUS;
  const Icon = TYPE_ICONS[type];

  const [isExpanded, setIsExpanded] = useState(false);
  const [showAddDropdown, setShowAddDropdown] = useState(false);
  const [addSearch, setAddSearch] = useState('');
  const [copied, setCopied] = useState(false);
  const [dropdownPos, setDropdownPos] = useState<{ left: number; top: number } | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const addBtnRef = useRef<HTMLButtonElement>(null);

  const syncText = lastSyncedAt
    ? formatDistanceToNow(new Date(lastSyncedAt), { addSuffix: true, locale: dateLocale })
    : t('playlist.neverSynced');

  const mappedIds = new Set(mandalaLabels.map((l) => l.mandalaId));
  const availableMandalas = mandalaOptions.filter((m) => !mappedIds.has(m.id));
  const filteredMandalas = availableMandalas.filter(
    (m) => !addSearch || m.title.toLowerCase().includes(addSearch.toLowerCase())
  );

  const closeDropdown = useCallback(() => {
    setShowAddDropdown(false);
    setAddSearch('');
  }, []);

  // Close on outside click (check both dropdown and button refs)
  useEffect(() => {
    if (!showAddDropdown) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(target) &&
        addBtnRef.current &&
        !addBtnRef.current.contains(target)
      ) {
        closeDropdown();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showAddDropdown, closeDropdown]);

  // Close on ESC + scroll
  useEffect(() => {
    if (!showAddDropdown) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeDropdown();
    };
    const onScroll = () => closeDropdown();
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [showAddDropdown, closeDropdown]);

  const handleCopyUrl = () => {
    if (youtubeUrl) {
      navigator.clipboard.writeText(youtubeUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div
      className={cn(
        'bg-surface-mid border border-border rounded-[10px] p-[13px_15px] cursor-pointer transition-all duration-[180ms] relative',
        'hover:bg-muted/20 hover:border-border/80 hover:-translate-y-px hover:shadow-lg',
        isPaused && 'opacity-[.45]'
      )}
    >
      {/* Top row */}
      <div className="flex items-center gap-[11px]">
        {/* Checkbox */}
        <div
          onClick={(e) => {
            e.stopPropagation();
            onSelect();
          }}
          className={cn(
            'w-[17px] h-[17px] border-[1.5px] rounded flex items-center justify-center flex-shrink-0 cursor-pointer transition-all',
            isSelected
              ? 'bg-primary border-primary'
              : 'border-muted-foreground/40 hover:border-muted-foreground/60'
          )}
        >
          {isSelected && (
            <div className="w-[9px] h-[5px] border-l-2 border-b-2 border-white -rotate-45 -translate-y-px" />
          )}
        </div>

        {/* Icon */}
        <span className="text-muted-foreground/50 flex-shrink-0">
          <Icon className="w-[18px] h-[18px]" />
        </span>

        {/* Body */}
        <div className="flex-1 min-w-0">
          <div
            className={cn(
              'font-semibold text-[13.5px] flex items-center gap-[5px]',
              isPaused && 'line-through decoration-muted-foreground/40'
            )}
          >
            {name}
            {youtubeUrl && (
              <a
                href={youtubeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground/60 hover:text-primary transition-colors"
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
          <div className="text-[11.5px] text-muted-foreground/50 mt-0.5 flex items-center gap-[7px]">
            {isPaused ? (
              <span className="px-[7px] py-[2px] rounded text-[10px] font-semibold tracking-wide bg-amber-400/10 text-amber-400">
                Paused
              </span>
            ) : (
              <span className="px-[7px] py-[2px] rounded text-[10px] font-semibold tracking-wide bg-primary/10 text-primary">
                {type === 'playlist' ? 'Playlist' : type === 'channel' ? 'Channel' : 'Hashtag'}
              </span>
            )}
            <span>{t('playlist.videoCount', { count: videoCount })}</span>
            <span>· {syncText}</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-0.5 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          {!isPaused && (
            <>
              <button
                onClick={onSync}
                disabled={isSyncing}
                className="w-[30px] h-[30px] rounded-[7px] flex items-center justify-center text-muted-foreground/50 border border-transparent hover:bg-white/[.05] hover:border-border hover:text-muted-foreground transition-all"
              >
                {isSyncing ? (
                  <Loader2 className="w-[14px] h-[14px] animate-spin" />
                ) : (
                  <RefreshCw className="w-[14px] h-[14px]" />
                )}
              </button>
              <button
                onClick={onPause}
                disabled={isPausing}
                className="w-[30px] h-[30px] rounded-[7px] flex items-center justify-center text-muted-foreground/50 border border-transparent hover:bg-white/[.05] hover:border-border hover:text-muted-foreground transition-all"
              >
                {isPausing ? (
                  <Loader2 className="w-[14px] h-[14px] animate-spin" />
                ) : (
                  <Pause className="w-[14px] h-[14px]" />
                )}
              </button>
            </>
          )}
          {isPaused && (
            <button
              onClick={onResume}
              disabled={isPausing}
              className="w-[30px] h-[30px] rounded-[7px] flex items-center justify-center text-primary border border-primary/30 hover:bg-primary/10 transition-all"
            >
              {isPausing ? (
                <Loader2 className="w-[14px] h-[14px] animate-spin" />
              ) : (
                <Play className="w-[14px] h-[14px]" />
              )}
            </button>
          )}
          <button
            onClick={onDelete}
            disabled={isDeleting}
            className="w-[30px] h-[30px] rounded-[7px] flex items-center justify-center text-muted-foreground/50 border border-transparent hover:bg-white/[.05] hover:border-border hover:text-muted-foreground transition-all"
          >
            {isDeleting ? (
              <Loader2 className="w-[14px] h-[14px] animate-spin" />
            ) : (
              <Trash2 className="w-[14px] h-[14px]" />
            )}
          </button>
        </div>

        {/* Chevron */}
        <span
          onClick={(e) => {
            e.stopPropagation();
            setIsExpanded(!isExpanded);
          }}
          className={cn(
            'text-muted-foreground/50 cursor-pointer transition-transform duration-200 flex-shrink-0 ml-0.5 flex',
            isExpanded && 'rotate-180'
          )}
        >
          <ChevronDown className="w-4 h-4" />
        </span>
      </div>

      {/* Mandala pills */}
      <div className="flex items-center gap-[5px] mt-[7px] ml-7 flex-wrap">
        {mandalaLabels.length > 0 ? (
          mandalaLabels.map((label) => (
            <span
              key={label.mandalaId}
              className="inline-flex items-center gap-1 px-[9px] py-[2px] rounded-xl text-[10.5px] font-medium bg-primary/10 text-primary"
            >
              #{label.title}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveLabel(label.mandalaId);
                }}
                className="opacity-50 hover:opacity-100 transition-opacity text-[9px]"
              >
                ✕
              </button>
            </span>
          ))
        ) : (
          <span className="inline-flex items-center gap-1 px-[9px] py-[2px] rounded-xl text-[10.5px] font-medium bg-muted/15 text-muted-foreground">
            🤖 AI
          </span>
        )}

        {/* [+] add */}
        {availableMandalas.length > 0 && (
          <>
            <button
              ref={addBtnRef}
              onClick={(e) => {
                e.stopPropagation();
                if (!showAddDropdown && addBtnRef.current) {
                  const rect = addBtnRef.current.getBoundingClientRect();
                  setDropdownPos({ left: rect.left, top: rect.bottom + 4 });
                }
                setShowAddDropdown(!showAddDropdown);
                setAddSearch('');
              }}
              className="w-5 h-5 rounded-full border border-dashed border-muted-foreground/40 flex items-center justify-center text-muted-foreground/40 hover:border-primary hover:text-primary hover:bg-primary/10 transition-all"
            >
              <Plus className="w-3 h-3" />
            </button>
            {showAddDropdown &&
              dropdownPos &&
              createPortal(
                <div
                  ref={dropdownRef}
                  className="fixed w-52 bg-surface-mid border border-border rounded-lg shadow-lg py-1"
                  style={{
                    left: dropdownPos.left,
                    top: dropdownPos.top,
                    zIndex: PORTAL_DROPDOWN_Z_INDEX,
                  }}
                >
                  <div className="px-2 pb-1">
                    <input
                      type="text"
                      value={addSearch}
                      onChange={(e) => setAddSearch(e.target.value)}
                      placeholder={t('youtube.searchMandala', 'Search...')}
                      className="w-full px-2.5 py-1.5 text-xs bg-surface-light border border-border rounded-md text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary"
                      autoFocus
                    />
                  </div>
                  <div className="max-h-40 overflow-y-auto">
                    {filteredMandalas.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => {
                          onAddLabel(m.id);
                          closeDropdown();
                        }}
                        className="w-full text-left px-3 py-1.5 text-xs text-foreground hover:bg-white/[.04] transition-colors truncate"
                      >
                        {m.title}
                      </button>
                    ))}
                    {filteredMandalas.length === 0 && (
                      <p className="text-xs text-muted-foreground text-center py-2">
                        {t('common.noResults', 'No results')}
                      </p>
                    )}
                  </div>
                </div>,
                document.body
              )}
          </>
        )}
      </div>

      {/* Expanded: URL only */}
      {isExpanded && youtubeUrl && (
        <div className="mt-2.5 pt-2.5 border-t border-border ml-7">
          <div className="flex items-center gap-1.5">
            <input
              value={youtubeUrl}
              readOnly
              className="flex-1 bg-surface-light border border-border rounded-[7px] px-[11px] py-[7px] text-muted-foreground text-xs font-mono outline-none"
              onClick={(e) => e.stopPropagation()}
            />
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleCopyUrl();
              }}
              className="w-[30px] h-[30px] rounded-[7px] bg-surface-mid border border-border flex items-center justify-center text-muted-foreground hover:border-border/80 hover:text-muted-foreground/80 transition-all"
            >
              {copied ? (
                <Check className="w-3.5 h-3.5 text-green-400" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
