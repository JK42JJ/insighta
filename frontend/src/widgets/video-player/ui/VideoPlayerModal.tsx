import { useRef, useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { InsightCard } from '@/entities/card/model/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/shared/ui/dialog';
import { GripHorizontal } from 'lucide-react';
import { getYouTubeVideoId } from '../model/youtube-api';
import type { YTPlayer } from '../model/youtube-api';
import { YouTubePlayer } from './YouTubePlayer';
import { MemoEditor } from './MemoEditor';
import { ExternalLinkView } from './ExternalLinkView';

const MEMO_MIN_HEIGHT = 120; // ~5 lines
const MEMO_MAX_HEIGHT = 320;
const MEMO_DEFAULT_HEIGHT = 160;

interface VideoPlayerModalProps {
  card: InsightCard | null;
  isOpen: boolean;
  onClose: () => void;
  onSave?: (id: string, note: string) => void;
  onSaveWatchPosition?: (id: string, position: number) => void;
  watchPositionCache?: Map<string, number>;
}

export function VideoPlayerModal({
  card,
  isOpen,
  onClose,
  onSave,
  onSaveWatchPosition,
  watchPositionCache,
}: VideoPlayerModalProps) {
  const { t } = useTranslation();
  const playerRef = useRef<YTPlayer | null>(null);
  const [playerReady, setPlayerReady] = useState(false);
  const [memoHeight, setMemoHeight] = useState(MEMO_DEFAULT_HEIGHT);
  const resizingRef = useRef(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(MEMO_DEFAULT_HEIGHT);

  useEffect(() => {
    setPlayerReady(false);
  }, [card?.id]);

  const handlePlayerReady = useCallback(() => {
    setPlayerReady(true);
  }, []);

  const handleSaveWatchPosition = useCallback(
    (positionSeconds: number) => {
      if (!card) return;
      onSaveWatchPosition?.(card.id, positionSeconds);
      watchPositionCache?.set(card.id, positionSeconds);
    },
    [card, onSaveWatchPosition, watchPositionCache]
  );

  const handleSave = useCallback(
    (id: string, note: string) => {
      onSave?.(id, note);
    },
    [onSave]
  );

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        if (card && playerRef.current && playerReady) {
          try {
            const currentTime = Math.floor(playerRef.current.getCurrentTime());
            onSaveWatchPosition?.(card.id, currentTime);
            watchPositionCache?.set(card.id, currentTime);
          } catch {
            // Player may already be destroyed
          }
        }
        onClose();
      }
    },
    [card, onClose, onSaveWatchPosition, watchPositionCache, playerReady]
  );

  // Resize handle: drag to adjust memo height (video stays aspect-ratio)
  const handleResizeStart = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      resizingRef.current = true;
      startYRef.current = e.clientY;
      startHeightRef.current = memoHeight;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [memoHeight]
  );

  const handleResizeMove = useCallback((e: React.PointerEvent) => {
    if (!resizingRef.current) return;
    // Dragging up = increasing memo height, dragging down = decreasing
    const delta = startYRef.current - e.clientY;
    const newHeight = Math.min(MEMO_MAX_HEIGHT, Math.max(MEMO_MIN_HEIGHT, startHeightRef.current + delta));
    setMemoHeight(newHeight);
  }, []);

  const handleResizeEnd = useCallback(() => {
    resizingRef.current = false;
  }, []);

  if (!card) return null;

  const videoId = getYouTubeVideoId(card.videoUrl);
  const isYouTube = videoId !== null;

  const cachedPosition = watchPositionCache?.get(card.id);
  const startTime = cachedPosition ?? (card.lastWatchPosition ? Math.floor(card.lastWatchPosition) : 0);

  const channelName = card.metadata?.author || card.metadata?.siteName || '';

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-w-3xl w-[95vw] max-h-[90vh] overflow-hidden p-0 flex flex-col"
        aria-describedby="video-player-description"
      >
        <DialogHeader className="px-4 pt-4 pb-0 flex-shrink-0">
          <DialogTitle className="text-base font-semibold line-clamp-2 pr-8">
            {card.title}
          </DialogTitle>
          <DialogDescription id="video-player-description" className="sr-only">
            {t('videoPlayer.memo')}
          </DialogDescription>
          {channelName && (
            <p className="text-xs text-muted-foreground">{channelName}</p>
          )}
        </DialogHeader>

        {isYouTube && videoId ? (
          <>
            {/* YouTube Video — aspect-ratio preserved, never changes */}
            <div className="px-4 flex-shrink-0">
              <div className="rounded-lg overflow-hidden">
                <YouTubePlayer
                  videoId={videoId}
                  startTime={startTime}
                  onPlayerReady={handlePlayerReady}
                  onSaveWatchPosition={handleSaveWatchPosition}
                  playerRef={playerRef}
                />
              </div>
            </div>

            {/* Resize Handle */}
            <div
              className="flex-shrink-0 flex items-center justify-center cursor-row-resize select-none py-0.5 group"
              onPointerDown={handleResizeStart}
              onPointerMove={handleResizeMove}
              onPointerUp={handleResizeEnd}
              onPointerCancel={handleResizeEnd}
            >
              <GripHorizontal className="w-5 h-3 text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors" />
            </div>

            {/* Memo Editor — resizable height */}
            <div className="flex-shrink-0 overflow-hidden" style={{ height: memoHeight }}>
              <MemoEditor
                note={card.userNote ?? ''}
                cardId={card.id}
                videoId={videoId}
                playerRef={playerRef}
                playerReady={playerReady}
                onSave={handleSave}
                isYouTube
              />
            </div>
          </>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto">
            <ExternalLinkView card={card} onSave={handleSave} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
