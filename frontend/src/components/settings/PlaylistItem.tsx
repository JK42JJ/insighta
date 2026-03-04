import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
} from '@/components/ui/alert-dialog';
import { Loader2, RefreshCw, Trash2, ExternalLink, AlertCircle } from 'lucide-react';
import type { YouTubePlaylist } from '@/types/youtube';
import { formatDistanceToNow } from 'date-fns';
import { ko } from 'date-fns/locale';

interface PlaylistItemProps {
  playlist: YouTubePlaylist;
  onSync: (playlistId: string) => void;
  onDelete: (playlistId: string) => void;
  isSyncing: boolean;
  isDeleting: boolean;
}

export function PlaylistItem({
  playlist,
  onSync,
  onDelete,
  isSyncing,
  isDeleting,
}: PlaylistItemProps) {
  const lastSyncedText = playlist.last_synced_at
    ? formatDistanceToNow(new Date(playlist.last_synced_at), {
        addSuffix: true,
        locale: ko,
      })
    : '동기화된 적 없음';

  const statusBadge = () => {
    switch (playlist.sync_status) {
      case 'syncing':
        return <Badge variant="secondary">동기화 중...</Badge>;
      case 'completed':
        return <Badge variant="default" className="bg-green-600">완료</Badge>;
      case 'failed':
        return <Badge variant="destructive">실패</Badge>;
      default:
        return <Badge variant="outline">대기 중</Badge>;
    }
  };

  return (
    <div className="flex items-center gap-4 p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors">
      {/* Thumbnail */}
      <div className="flex-shrink-0 w-16 h-12 rounded overflow-hidden bg-muted">
        {playlist.thumbnail_url ? (
          <img
            src={playlist.thumbnail_url}
            alt={playlist.title || 'Playlist thumbnail'}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
            <svg
              className="w-6 h-6"
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <path d="M4 4h16a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2zm0 2v12h16V6H4zm6 3l6 3-6 3V9z" />
            </svg>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h4 className="font-medium text-sm truncate">
            {playlist.title || '제목 없음'}
          </h4>
          <a
            href={playlist.youtube_playlist_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-foreground"
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
        <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
          <span>{playlist.item_count}개 동영상</span>
          <span>•</span>
          <span>{lastSyncedText}</span>
          {statusBadge()}
        </div>
        {playlist.sync_status === 'failed' && playlist.sync_error && (
          <div className="flex items-center gap-1 mt-1 text-xs text-destructive">
            <AlertCircle className="h-3 w-3" />
            <span className="truncate">{playlist.sync_error}</span>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onSync(playlist.id)}
          disabled={isSyncing || playlist.sync_status === 'syncing'}
          title="동기화"
        >
          {isSyncing || playlist.sync_status === 'syncing' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </Button>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              disabled={isDeleting}
              title="삭제"
            >
              {isDeleting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>플레이리스트를 삭제하시겠습니까?</AlertDialogTitle>
              <AlertDialogDescription>
                "{playlist.title}" 플레이리스트가 삭제됩니다.
                이미 아이디에이션 팔레트에 추가된 동영상은 유지됩니다.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>취소</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => onDelete(playlist.id)}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                삭제
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
