import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Play, ExternalLink } from 'lucide-react';
import type { YTPlayer } from '../model/youtube-api';

interface NotePreviewProps {
  note: string;
  videoId: string | null;
  playerRef: React.MutableRefObject<YTPlayer | null>;
  playerReady: boolean;
  onEditClick: () => void;
}

export function NotePreview({
  note,
  playerRef,
  playerReady,
  onEditClick,
}: NotePreviewProps) {
  const { t } = useTranslation();

  const extractTimestampSeconds = useCallback((url: string): number | null => {
    const tMatch = url.match(/[?&]t=(\d+)/);
    return tMatch ? parseInt(tMatch[1], 10) : null;
  }, []);

  const handleTimestampClick = useCallback(
    (url: string, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const isYouTubeTimestamp = url.includes('youtube.com') || url.includes('youtu.be');
      const seconds = isYouTubeTimestamp ? extractTimestampSeconds(url) : null;

      if (isYouTubeTimestamp && seconds !== null && playerRef.current && playerReady) {
        playerRef.current.seekTo(seconds, true);
      } else {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    },
    [playerRef, playerReady, extractTimestampSeconds]
  );

  if (!note) {
    return (
      <div className="text-sm h-full cursor-text py-1" onClick={onEditClick}>
        <span className="text-muted-foreground/60 text-xs">
          {t('videoPlayer.clickToWriteNote')}
        </span>
      </div>
    );
  }

  return (
    <div
      className="text-sm h-full overflow-y-auto cursor-text py-1 scrollbar-thin"
      onClick={onEditClick}
    >
      <div className="space-y-0.5 text-foreground/60">
        {note.split('\n').map((line, lineIdx) => {
          const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g;
          const parts: React.ReactNode[] = [];
          let lastIndex = 0;
          let match: RegExpExecArray | null;

          while ((match = linkRegex.exec(line)) !== null) {
            if (match.index > lastIndex) {
              parts.push(
                <span key={`t-${lineIdx}-${lastIndex}`}>
                  {line.slice(lastIndex, match.index)}
                </span>
              );
            }

            const url = match[2];
            const label = match[1];
            const isYT = url.includes('youtube.com') || url.includes('youtu.be');
            const seconds = isYT ? extractTimestampSeconds(url) : null;
            const isTimestamp = isYT && seconds !== null;

            parts.push(
              isTimestamp ? (
                <button
                  key={`l-${lineIdx}-${match.index}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleTimestampClick(url, e);
                  }}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                >
                  {label}
                  <Play className="w-2.5 h-2.5" />
                </button>
              ) : (
                <a
                  key={`l-${lineIdx}-${match.index}`}
                  href={url}
                  onClick={(e) => handleTimestampClick(url, e)}
                  className="text-primary hover:underline inline-flex items-center gap-0.5"
                >
                  {label}
                  <ExternalLink className="w-3 h-3" />
                </a>
              )
            );
            lastIndex = match.index + match[0].length;
          }

          if (lastIndex < line.length) {
            parts.push(<span key={`t-${lineIdx}-end`}>{line.slice(lastIndex)}</span>);
          }

          if (parts.length === 0 && line) {
            parts.push(<span key={`line-${lineIdx}`}>{line}</span>);
          }

          return parts.length > 0 ? (
            <div key={lineIdx} className="whitespace-pre-wrap">
              {parts}
            </div>
          ) : (
            <div key={lineIdx}>&nbsp;</div>
          );
        })}
      </div>
    </div>
  );
}
