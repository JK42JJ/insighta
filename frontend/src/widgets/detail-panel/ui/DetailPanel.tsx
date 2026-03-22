import { useEffect, useRef, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, ExternalLink } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/shared/ui/resizable';
import type { InsightCard } from '@/entities/card/model/types';
import { SourceTypeBadge } from '@/entities/content';
import { YouTubePlayer } from '@/widgets/video-player/ui/YouTubePlayer';
import { MemoEditor } from '@/widgets/video-player/ui/MemoEditor';
import { ExternalLinkView } from '@/widgets/video-player/ui/ExternalLinkView';
import { getYouTubeVideoId } from '@/widgets/video-player/model/youtube-api';
import { DEFAULT_DETAIL_PANEL_RATIO } from '@/pages/index/model/useVideoModal';
import type { YTPlayer } from '@/widgets/video-player/model/youtube-api';

interface DetailPanelProps {
  card: InsightCard | null;
  onSaveNote?: (id: string, note: string) => void;
  onSaveWatchPosition?: (id: string, positionSeconds: number) => void;
  watchPositionCache?: Map<string, number>;
  panelSizeCache?: Map<string, number>;
  onClose?: () => void;
}

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function DetailPanel({ card, onSaveNote, onSaveWatchPosition, watchPositionCache, panelSizeCache, onClose }: DetailPanelProps) {
  const { t } = useTranslation();
  const playerRef = useRef<YTPlayer | null>(null);
  const cardIdRef = useRef<string | null>(null);
  const [playerReady, setPlayerReady] = useState(false);

  const handlePlayerReady = useCallback(() => {
    setPlayerReady(true);
  }, []);

  // Reset playerReady on card change
  useEffect(() => {
    setPlayerReady(false);
  }, [card?.id]);

  // Save watch position on card switch or unmount
  useEffect(() => {
    const prevId = cardIdRef.current;
    cardIdRef.current = card?.id ?? null;

    return () => {
      if (playerRef.current && prevId) {
        try {
          const t = Math.floor(playerRef.current.getCurrentTime());
          onSaveWatchPosition?.(prevId, t);
          watchPositionCache?.set(prevId, t);
        } catch {
          // player already destroyed
        }
      }
    };
  }, [card?.id]);

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
      onSaveNote?.(id, note);
    },
    [onSaveNote]
  );

  const handleLayout = useCallback(
    (sizes: number[]) => {
      if (card) panelSizeCache?.set(card.id, sizes[0]);
    },
    [card, panelSizeCache]
  );

  if (!card) {
    return (
      <div className="h-full flex items-center justify-center p-6 text-center">
        <div className="text-muted-foreground">
          <p className="text-sm">{t('view.noCardSelected')}</p>
          <p className="text-xs mt-1">{t('view.selectCardHint')}</p>
        </div>
      </div>
    );
  }

  const videoId = card.videoUrl ? getYouTubeVideoId(card.videoUrl) : null;
  const isYouTube = videoId !== null;
  const cachedPosition = watchPositionCache?.get(card.id);
  const startTime = cachedPosition ?? (card.lastWatchPosition ? Math.floor(card.lastWatchPosition) : 0);
  const cachedPanelSize = panelSizeCache?.get(card.id) ?? DEFAULT_DETAIL_PANEL_RATIO;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {card.linkType && <SourceTypeBadge linkType={card.linkType} />}
          <span className="text-xs text-muted-foreground truncate">
            {formatDate(card.createdAt)}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {card.videoUrl && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => window.open(card.videoUrl, '_blank', 'noopener,noreferrer')}
              title={t('videoPlayer.viewOriginal')}
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          )}
          {onClose && (
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClose}>
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Content */}
      {isYouTube && videoId ? (
        <ResizablePanelGroup direction="vertical" className="flex-1 min-h-0" onLayout={handleLayout}>
          <ResizablePanel defaultSize={cachedPanelSize} minSize={25}>
            <YouTubePlayer
              key={card.id}
              videoId={videoId}
              startTime={startTime}
              onPlayerReady={handlePlayerReady}
              onSaveWatchPosition={handleSaveWatchPosition}
              playerRef={playerRef}
              className="h-full"
            />
          </ResizablePanel>
          <ResizableHandle withHandle />
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
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <ExternalLinkView card={card} onSave={handleSave} />
        </div>
      )}
    </div>
  );
}
