/**
 * YouTube iframe embed for the side panel.
 * Keyed by videoUrl so the iframe remounts on card change.
 *
 * Design tokens: insighta-side-editor-mockup-v3.html
 */
import { getYouTubeVideoId } from '@/widgets/video-player/model/youtube-api';

export interface PanelVideoPlayerProps {
  videoUrl: string;
  /** Resume playback from this position (seconds). */
  startTime?: number;
}

export function PanelVideoPlayer({ videoUrl, startTime }: PanelVideoPlayerProps) {
  const youtubeId = getYouTubeVideoId(videoUrl);

  if (!youtubeId) {
    // Non-YouTube URL — show a simple link preview placeholder.
    return (
      <div className="flex w-full items-center justify-center bg-black aspect-video shrink-0">
        <a
          href={videoUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="max-w-[80%] truncate text-xs text-[#4e4f5c] underline underline-offset-2 hover:text-[#9394a0]"
        >
          {videoUrl}
        </a>
      </div>
    );
  }

  return (
    <div className="w-full bg-black shrink-0">
      <iframe
        key={videoUrl}
        src={`https://www.youtube.com/embed/${youtubeId}?autoplay=1&rel=0${startTime ? `&start=${Math.floor(startTime)}` : ''}`}
        className="w-full aspect-video"
        allow="autoplay; encrypted-media"
        allowFullScreen
        title="Video player"
      />
    </div>
  );
}
