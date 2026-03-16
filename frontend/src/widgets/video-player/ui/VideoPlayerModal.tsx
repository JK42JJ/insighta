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

  if (!card) return null;

  const videoId = getYouTubeVideoId(card.videoUrl);
  const isYouTube = videoId !== null;

  const cachedPosition = watchPositionCache?.get(card.id);
  const startTime = cachedPosition ?? (card.lastWatchPosition ? Math.floor(card.lastWatchPosition) : 0);

  const channelName = card.metadata?.author || card.metadata?.siteName || '';

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-w-3xl w-[95vw] h-[85vh] overflow-hidden p-0 flex flex-col"
        aria-describedby="video-player-description"
      >
        <DialogDescription id="video-player-description" className="sr-only">
          {t('videoPlayer.memo')}
        </DialogDescription>

        {isYouTube && videoId ? (
          <ResizablePanelGroup direction="vertical" className="flex-1 min-h-0">
            {/* Video Panel */}
            <ResizablePanel defaultSize={65} minSize={30}>
              <div className="flex flex-col h-full">
                {/* Title bar inside video panel */}
                <div className="px-4 pt-3 pb-1 flex-shrink-0">
                  <h2 className="text-base font-semibold line-clamp-2 pr-8">
                    {card.title}
                  </h2>
                  {channelName && (
                    <p className="text-xs text-muted-foreground">{channelName}</p>
                  )}
                </div>
                {/* Video fills remaining space */}
                <div className="flex-1 min-h-0 px-4 pb-1">
                  <YouTubePlayer
                    videoId={videoId}
                    startTime={startTime}
                    onPlayerReady={handlePlayerReady}
                    onSaveWatchPosition={handleSaveWatchPosition}
                    playerRef={playerRef}
                    className="h-full rounded-lg overflow-hidden"
                  />
                </div>
              </div>
            </ResizablePanel>

            {/* Resize Handle */}
            <ResizableHandle withHandle />

            {/* Memo Panel */}
            <ResizablePanel defaultSize={35} minSize={15}>
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
