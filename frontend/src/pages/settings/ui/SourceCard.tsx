import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { Badge } from '@/shared/ui/badge';
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
  Bot,
  X as XIcon,
  Plus,
  ChevronUp,
  Copy,
  Check,
} from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { formatDistanceToNow, format } from 'date-fns';
import { ko, enUS } from 'date-fns/locale';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/shared/ui/alert-dialog';

type SourceType = 'playlist' | 'channel' | 'hashtag';

const TYPE_ICONS: Record<SourceType, React.ComponentType<{ className?: string }>> = {
  playlist: ListVideo,
  channel: Tv,
  hashtag: Hash,
};

const TYPE_LABELS: Record<SourceType, string> = {
  playlist: 'Playlist',
  channel: 'Channel',
  hashtag: 'Hashtag',
};

interface MandalaLabel {
  mandalaId: string;
  title: string;
}

interface MandalaOption {
  id: string;
  title: string;
}

interface SourceCardProps {
  name: string;
  type: SourceType;
  videoCount: number;
  lastSyncedAt: string | null;
  createdAt?: string;
  youtubeUrl?: string;
  isPaused: boolean;
  mandalaLabels: MandalaLabel[];
  mandalaOptions: MandalaOption[];
  onSync: () => void;
  onPause: () => void;
  onResume: () => void;
  onDelete: () => void;
  onRemoveLabel: (mandalaId: string) => void;
  onAddLabel: (mandalaId: string) => void;
  onRename: (newName: string) => void;
  isSyncing: boolean;
  isPausing: boolean;
  isDeleting: boolean;
}

export function SourceCard({
  name,
  type,
  videoCount,
  lastSyncedAt,
  createdAt,
  youtubeUrl,
  isPaused,
  mandalaLabels,
  mandalaOptions,
  onSync,
  onPause,
  onResume,
  onDelete,
  onRemoveLabel,
  onAddLabel,
  onRename,
  isSyncing,
  isPausing,
  isDeleting,
}: SourceCardProps) {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language.startsWith('ko') ? ko : enUS;
  const Icon = TYPE_ICONS[type];

  const [isExpanded, setIsExpanded] = useState(false);
  const [showAddDropdown, setShowAddDropdown] = useState(false);
  const [addSearch, setAddSearch] = useState('');
  const [copied, setCopied] = useState(false);
  const [editName, setEditName] = useState(name);
  const [isSaving, setIsSaving] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const syncText = lastSyncedAt
    ? formatDistanceToNow(new Date(lastSyncedAt), { addSuffix: true, locale: dateLocale })
    : t('playlist.neverSynced');

  const mappedIds = new Set(mandalaLabels.map((l) => l.mandalaId));
  const availableMandalas = mandalaOptions.filter((m) => !mappedIds.has(m.id));
  const filteredMandalas = availableMandalas.filter(
    (m) => !addSearch || m.title.toLowerCase().includes(addSearch.toLowerCase())
  );

  // Close dropdown on outside click
  useEffect(() => {
    if (!showAddDropdown) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowAddDropdown(false);
        setAddSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showAddDropdown]);

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
        'rounded-lg border border-border/50 bg-surface-mid transition-colors',
        isPaused && 'opacity-50'
      )}
    >
      {/* Main row */}
      <div
        className="flex items-center gap-3 p-3 cursor-pointer hover:bg-surface-mid/80 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {/* Icon */}
        <div className="w-9 h-9 rounded-lg bg-surface-light flex items-center justify-center flex-shrink-0">
          <Icon className="w-4.5 h-4.5 text-muted-foreground" />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'text-sm font-medium truncate',
                isPaused && 'line-through text-muted-foreground'
              )}
            >
              {name}
            </span>
            {isPaused && (
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0 h-4 text-muted-foreground"
              >
                {t('playlist.paused')}
              </Badge>
            )}
            {youtubeUrl && (
              <a
                href={youtubeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground"
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
              {TYPE_LABELS[type]}
            </Badge>
            <span>{t('playlist.videoCount', { count: videoCount })}</span>
            <span>·</span>
            <span>{syncText}</span>
          </div>

          {/* Mandala pills (compact, always visible) */}
          <div className="flex items-center gap-1 mt-1.5 flex-wrap">
            {mandalaLabels.length > 0 ? (
              mandalaLabels.map((label) => (
                <span
                  key={label.mandalaId}
                  className="inline-flex items-center gap-0.5 text-[10px] font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20"
                >
                  {label.title}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveLabel(label.mandalaId);
                    }}
                    className="ml-0.5 opacity-60 hover:opacity-100 transition-opacity"
                  >
                    <XIcon className="w-2.5 h-2.5" />
                  </button>
                </span>
              ))
            ) : (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                <Bot className="w-2.5 h-2.5" />
                AI
              </span>
            )}

            {/* [+] Add mandala button */}
            {availableMandalas.length > 0 && (
              <div className="relative" ref={dropdownRef}>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowAddDropdown(!showAddDropdown);
                    setAddSearch('');
                  }}
                  className="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full border border-dashed border-border/60 text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
                >
                  <Plus className="w-2.5 h-2.5" />
                </button>

                {showAddDropdown && (
                  <div className="absolute left-0 top-full mt-1 w-52 bg-surface-mid border border-border rounded-lg shadow-lg z-50 py-1">
                    <div className="px-2 pb-1">
                      <input
                        type="text"
                        value={addSearch}
                        onChange={(e) => setAddSearch(e.target.value)}
                        placeholder={t('youtube.searchMandala', 'Search...')}
                        className="w-full px-2.5 py-1.5 text-xs bg-surface-light border border-border/50 rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>
                    <div className="max-h-40 overflow-y-auto">
                      {filteredMandalas.map((m) => (
                        <button
                          key={m.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            onAddLabel(m.id);
                            setShowAddDropdown(false);
                            setAddSearch('');
                          }}
                          className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted/50 transition-colors truncate"
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
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onSync}
            disabled={isSyncing}
            title={t('playlist.sync')}
          >
            {isSyncing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
          </Button>

          <Button
            variant={isPaused ? 'default' : 'ghost'}
            size="icon"
            className={cn(
              'h-8 w-8',
              isPaused && 'bg-primary text-primary-foreground hover:bg-primary/90'
            )}
            onClick={isPaused ? onResume : onPause}
            disabled={isPausing}
            title={isPaused ? t('playlist.resume') : t('playlist.pause')}
          >
            {isPausing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : isPaused ? (
              <Play className="h-3.5 w-3.5" />
            ) : (
              <Pause className="h-3.5 w-3.5" />
            )}
          </Button>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                disabled={isDeleting}
                title={t('common.delete')}
              >
                {isDeleting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t('playlist.deleteConfirmTitle')}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t('playlist.deleteConfirmDesc', { title: name })}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                <AlertDialogAction
                  onClick={onDelete}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {t('common.delete')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* Expanded detail panel */}
      {isExpanded && (
        <div className="px-3 pb-3 pt-0 border-t border-border/30 space-y-3">
          <div className="flex items-center justify-end pt-2">
            <button
              onClick={() => setIsExpanded(false)}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              <ChevronUp className="w-3 h-3" />
              {t('common.collapse', 'Collapse')}
            </button>
          </div>

          {/* Name edit */}
          <div className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">
              {t('common.name', 'Name')}
            </span>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.currentTarget.blur();
                  }
                }}
                onBlur={async () => {
                  const trimmed = editName.trim();
                  if (trimmed && trimmed !== name) {
                    setIsSaving(true);
                    onRename(trimmed);
                    setIsSaving(false);
                  }
                }}
                className="flex-1 text-sm bg-surface-light px-2.5 py-1.5 rounded-md border border-border/50 text-foreground focus:outline-none focus:border-primary"
              />
              {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            </div>
          </div>

          {/* Source URL */}
          {youtubeUrl && (
            <div className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">
                {t('sources.sourceUrl', 'Source URL')}
              </span>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs bg-surface-light px-2.5 py-1.5 rounded-md truncate text-muted-foreground">
                  {youtubeUrl}
                </code>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 flex-shrink-0"
                  onClick={handleCopyUrl}
                >
                  {copied ? (
                    <Check className="h-3 w-3 text-green-500" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </Button>
              </div>
            </div>
          )}

          {/* Meta info */}
          <div className="text-xs text-muted-foreground">
            {createdAt && (
              <span>
                {t('sources.addedOn', 'Added')}:{' '}
                {format(new Date(createdAt), 'yyyy-MM-dd', { locale: dateLocale })}
              </span>
            )}
            {createdAt && lastSyncedAt && <span className="mx-2">·</span>}
            {lastSyncedAt && (
              <span>
                {t('sources.lastSync', 'Last sync')}: {syncText}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
