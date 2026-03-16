import { useRef, useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { InsightCard } from '@/entities/card/model/types';
import {
  Dialog,
  DialogContent,
  DialogDescription,
} from '@/shared/ui/dialog';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/shared/ui/resizable';
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
}

export function VideoPlayerModal({
  card,
  isOpen,
  onClose,
  onSave,
  onSaveWatchPosition,
  watchPositionCache,
  panelSizeCache,
}: VideoPlayerModalProps) {
  const { t } = useTranslation();
  const playerRef = useRef<YTPlayer | null>(null);
  const [playerReady, setPlayerReady] = useState(false);

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
  const startTime = cachedPosition ?? (card.lastWatchPosition ? Math.floor(card.lastWatchPosition) : 0);
  const cachedPanelSize = panelSizeCache?.get(card.id) ?? 65;

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-w-3xl w-[95vw] h-[85vh] overflow-hidden p-0 flex flex-col outline-none border-0 focus:ring-0 focus:ring-offset-0 [&>button]:z-20 [&>button]:bg-black/60 [&>button]:text-white [&>button]:rounded-full [&>button]:p-1.5 [&>button]:opacity-90 [&>button]:hover:opacity-100 [&>button]:hover:bg-black/80 [&>button]:focus:ring-0 [&>button]:focus:ring-offset-0 [&>button]:right-2 [&>button]:top-2"
        aria-describedby="video-player-description"
        style={{ border: 'none' }}
      >
        <DialogDescription id="video-player-description" className="sr-only">
          {t('videoPlayer.memo')}
        </DialogDescription>

        {isYouTube && videoId ? (
          <ResizablePanelGroup direction="vertical" className="flex-1 min-h-0" onLayout={handleLayout}>
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
            <ResizableHandle withHandle />

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
