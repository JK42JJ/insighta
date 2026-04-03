import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { Badge } from '@/shared/ui/badge';
import { Loader2, RefreshCw, Trash2, ExternalLink, ListVideo, Tv, Hash } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
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

interface SourceCardProps {
  name: string;
  type: SourceType;
  videoCount: number;
  lastSyncedAt: string | null;
  youtubeUrl?: string;
  onSync: () => void;
  onDelete: () => void;
  isSyncing: boolean;
  isDeleting: boolean;
}

export function SourceCard({
  name,
  type,
  videoCount,
  lastSyncedAt,
  youtubeUrl,
  onSync,
  onDelete,
  isSyncing,
  isDeleting,
}: SourceCardProps) {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language.startsWith('ko') ? ko : enUS;
  const Icon = TYPE_ICONS[type];

  const syncText = lastSyncedAt
    ? formatDistanceToNow(new Date(lastSyncedAt), { addSuffix: true, locale: dateLocale })
    : t('playlist.neverSynced');

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border border-border/50 bg-surface-mid hover:bg-surface-mid/80 transition-colors">
      {/* Icon */}
      <div className="w-9 h-9 rounded-lg bg-surface-light flex items-center justify-center flex-shrink-0">
        <Icon className="w-4.5 h-4.5 text-muted-foreground" />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{name}</span>
          {youtubeUrl && (
            <a
              href={youtubeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground"
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
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 flex-shrink-0">
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
  );
}
