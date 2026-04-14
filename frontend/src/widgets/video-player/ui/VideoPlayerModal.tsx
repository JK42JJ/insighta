import { useRef, useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { InsightCard } from '@/entities/card/model/types';
import { Dialog, DialogContent, DialogDescription } from '@/shared/ui/dialog';
import { DEFAULT_VIDEO_PANEL_RATIO } from '@/pages/index/model/useVideoModal';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/shared/ui/resizable';
import { getYouTubeVideoId } from '../model/youtube-api';
import type { YTPlayer } from '../model/youtube-api';
import { YouTubePlayer } from './YouTubePlayer';
import { MemoEditor } from './MemoEditor';
import { ExternalLinkView } from './ExternalLinkView';

interface VideoPlayerModalProps {
  card: InsightCard | null;
  isOpen: boolean;
  onClose: () => void;
  onSave?: (id: string, note: string) => void;
  onSaveWatchPosition?: (id: string, position: number) => void;
  watchPositionCache?: Map<string, number>;
  panelSizeCache?: Map<string, number>;
  onEnrichStart?: (cardId: string) => void;
  onEnrichEnd?: (cardId: string) => void;
  /** Navigate to previous card in the displayed list */
  onPrev?: () => void;
  /** Navigate to next card in the displayed list */
  onNext?: () => void;
  /** Whether prev navigation is available */
  hasPrev?: boolean;
  /** Whether next navigation is available */
  hasNext?: boolean;
}

export function VideoPlayerModal({
  card,
  isOpen,
  onClose,
  onSave,
  onSaveWatchPosition,
  watchPositionCache,
  panelSizeCache,
  onEnrichStart,
  onEnrichEnd,
  onPrev,
  onNext,
  hasPrev = false,
  hasNext = false,
}: VideoPlayerModalProps) {
  const { t } = useTranslation();
  const playerRef = useRef<YTPlayer | null>(null);
  const [playerReady, setPlayerReady] = useState(false);

  useEffect(() => {
    setPlayerReady(false);
  }, [card?.id]);

  // Keyboard navigation: ← prev, → next (only when modal open)
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      // Don't intercept while typing in inputs/textareas/contenteditable
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }
      if (e.key === 'ArrowLeft' && hasPrev && onPrev) {
        e.preventDefault();
        onPrev();
      } else if (e.key === 'ArrowRight' && hasNext && onNext) {
        e.preventDefault();
        onNext();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, hasPrev, hasNext, onPrev, onNext]);

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

  const handleLayout = useCallback(
    (sizes: number[]) => {
      if (card) panelSizeCache?.set(card.id, sizes[0]);
    },
    [card, panelSizeCache]
  );

  if (!card) return null;

  const videoId = getYouTubeVideoId(card.videoUrl);
  const isYouTube = videoId !== null;

  const cachedPosition = watchPositionCache?.get(card.id);
  const startTime =
    cachedPosition ?? (card.lastWatchPosition ? Math.floor(card.lastWatchPosition) : 0);
  const cachedPanelSize = panelSizeCache?.get(card.id) ?? DEFAULT_VIDEO_PANEL_RATIO;

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-w-3xl w-[95vw] overflow-hidden p-0 flex flex-col outline-none border-0 focus:ring-0 focus:ring-offset-0 [&>button]:z-20 [&>button]:bg-black/60 [&>button]:text-white [&>button]:rounded-full [&>button]:p-1.5 [&>button]:opacity-90 [&>button]:hover:opacity-100 [&>button]:hover:bg-black/80 [&>button]:focus:ring-0 [&>button]:focus:ring-offset-0 [&>button]:right-2 [&>button]:top-2"
        aria-describedby="video-player-description"
        style={{
          border: 'none',
          height: 'calc(min(53.4375vw, 27rem) + 10rem)',
          maxHeight: '90vh',
        }}
      >
        <DialogDescription id="video-player-description" className="sr-only">
          {t('videoPlayer.memo')}
        </DialogDescription>

        {/* Prev/Next navigation arrows — anchored to modal edges (absolute), OUTSIDE
            the visible content area. -left-14/-right-14 places them just beyond the
            modal container. e.stopPropagation prevents Radix outside-click close. */}
        {hasPrev && onPrev && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onPrev();
            }}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label={t('videoPlayer.prevCard', 'Previous card')}
            className="absolute -left-14 top-1/2 -translate-y-1/2 z-30 flex h-12 w-12 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm transition-all hover:bg-black/80 hover:scale-110 focus:outline-none focus:ring-2 focus:ring-white/30"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
        )}
        {hasNext && onNext && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onNext();
            }}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label={t('videoPlayer.nextCard', 'Next card')}
            className="absolute -right-14 top-1/2 -translate-y-1/2 z-30 flex h-12 w-12 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm transition-all hover:bg-black/80 hover:scale-110 focus:outline-none focus:ring-2 focus:ring-white/30"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        )}

        {isYouTube && videoId ? (
          <ResizablePanelGroup
            direction="vertical"
            className="flex-1 min-h-0"
            onLayout={handleLayout}
          >
            {/* Video Panel */}
            <ResizablePanel defaultSize={cachedPanelSize} minSize={30}>
              <YouTubePlayer
                videoId={videoId}
                startTime={startTime}
                onPlayerReady={handlePlayerReady}
                onSaveWatchPosition={handleSaveWatchPosition}
                playerRef={playerRef}
                className="h-full"
              />
            </ResizablePanel>

            {/* Resize Handle */}
            <ResizableHandle
              withHandle
              className="opacity-0 hover:opacity-100 [&[data-resize-handle-state=drag]]:opacity-100 transition-opacity duration-200"
            />

            {/* Memo Panel */}
            <ResizablePanel defaultSize={100 - cachedPanelSize} minSize={15}>
              <MemoEditor
                note={card.userNote ?? ''}
                cardId={card.id}
                videoId={videoId}
                playerRef={playerRef}
                playerReady={playerReady}
                onSave={handleSave}
                isYouTube
                sourceTable={card.sourceTable}
                videoSummary={card.videoSummary}
                onEnrichStart={onEnrichStart}
                onEnrichEnd={onEnrichEnd}
                card={card}
                onCloseModal={onClose}
              />
            </ResizablePanel>
          </ResizablePanelGroup>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto">
            <ExternalLinkView card={card} onSave={handleSave} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
