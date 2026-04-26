import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';
import { PanelVideoPlayer } from '@/features/video-side-panel/ui/PanelVideoPlayer';
import { PanelAISummary } from '@/features/video-side-panel/ui/PanelAISummary';
import type { YTPlayer } from '@/widgets/video-player/model/youtube-api';

interface CenterPanelProps {
  mandalaId: string;
  videoId: string;
  playerRef: React.MutableRefObject<YTPlayer | null>;
  shouldAutoplay?: boolean;
  onUserPlayed?: () => void;
  onPlayStateChange?: (isPlaying: boolean) => void;
  startTime?: number;
}

export function CenterPanel({
  videoId,
  playerRef,
  shouldAutoplay = false,
  onUserPlayed,
  onPlayStateChange,
  startTime,
}: CenterPanelProps) {
  const { t } = useTranslation();
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

  return (
    <div className="flex flex-1 min-w-0 flex-col overflow-hidden px-10">
      <div className="shrink-0">
        <PanelVideoPlayer
          videoUrl={videoUrl}
          playerRef={playerRef}
          shouldAutoplay={shouldAutoplay}
          onUserPlayed={onUserPlayed}
          onPlayStateChange={onPlayStateChange}
          startTime={startTime}
        />
      </div>

      <div className="flex items-center gap-1.5 shrink-0 border-b border-border px-4 py-2.5">
        <Sparkles className="h-3.5 w-3.5 text-primary" />
        <span className="text-[12px] font-semibold text-foreground">
          {t('learning.tabSummary', 'AI 요약')}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-pro p-4">
        <PanelAISummary videoSummary={undefined} videoUrl={videoUrl} />
      </div>
    </div>
  );
}
