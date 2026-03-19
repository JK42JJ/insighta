import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Play, ExternalLink } from 'lucide-react';
import type { YTPlayer } from '../model/youtube-api';
import { parseNoteMarkdown, extractTimestampSeconds, type ParsedSegment } from '@/shared/lib/note-markdown';

interface NotePreviewProps {
  note: string;
  videoId: string | null;
  playerRef: React.MutableRefObject<YTPlayer | null>;
  playerReady: boolean;
  onEditClick: () => void;
}

const AI_SUMMARY_PREFIX_EN = '🤖 AI Summary:\n';
const AI_SUMMARY_PREFIX_KO = '🤖 AI 요약:\n';

/**
 * Filter bilingual AI summary to show only the locale-matching version.
 */
function filterNoteByLocale(note: string, locale: string): string {
  if (!note.includes(AI_SUMMARY_PREFIX_EN) && !note.includes(AI_SUMMARY_PREFIX_KO)) {
    return note;
  }

  const lines = note.split('\n');
  const result: string[] = [];
  let skipBlock = false;
  const targetPrefix = locale === 'ko' ? AI_SUMMARY_PREFIX_EN : AI_SUMMARY_PREFIX_KO;

  for (const line of lines) {
    // Start skipping the non-target language block
    if (line.startsWith(targetPrefix.trim())) {
      skipBlock = true;
      continue;
    }
    // End of skipped block: empty line after skipped content
    if (skipBlock && line.trim() === '') {
      skipBlock = false;
      continue;
    }
    if (!skipBlock) {
      result.push(line);
    }
  }

  return result.join('\n').trim();
}

export function NotePreview({
  note,
  playerRef,
  playerReady,
  onEditClick,
}: NotePreviewProps) {
  const { t, i18n } = useTranslation();
  const filteredNote = useMemo(() => filterNoteByLocale(note, i18n.language), [note, i18n.language]);
  const parsedLines = useMemo(() => parseNoteMarkdown(filteredNote), [filteredNote]);

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
    [playerRef, playerReady]
  );

  if (!filteredNote) {
    return (
      <div className="text-sm h-full cursor-text py-1" onClick={onEditClick}>
        <span className="text-muted-foreground/60 text-xs">
          {t('videoPlayer.clickToWriteNote')}
        </span>
      </div>
    );
  }

  const renderSegment = (segment: ParsedSegment, lineIdx: number, segIdx: number) => {
    const key = `${lineIdx}-${segIdx}`;

    if (segment.type === 'image') {
      return (
        <button
          key={key}
          onClick={(e) => {
            e.stopPropagation();
            if (segment.seconds !== null && segment.seconds !== undefined && playerRef.current && playerReady) {
              playerRef.current.seekTo(segment.seconds, true);
            }
          }}
          className="block my-1"
        >
          <img
            src={segment.imageUrl}
            alt={segment.content}
            className="max-h-20 rounded-md border border-border/20 hover:border-primary/40 transition-colors"
            loading="lazy"
          />
        </button>
      );
    }

    if (segment.type === 'timestamp') {
      return (
        <button
          key={key}
          onClick={(e) => {
            e.stopPropagation();
            if (segment.url) handleTimestampClick(segment.url, e);
          }}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
        >
          {segment.content}
          <Play className="w-2.5 h-2.5" />
        </button>
      );
    }

    if (segment.type === 'link') {
      return (
        <a
          key={key}
          href={segment.url}
          onClick={(e) => {
            if (segment.url) handleTimestampClick(segment.url, e);
          }}
          className="text-primary hover:underline inline-flex items-center gap-0.5"
        >
          {segment.content}
          <ExternalLink className="w-3 h-3" />
        </a>
      );
    }

    return <span key={key}>{segment.content}</span>;
  };

  return (
    <div
      className="text-sm h-full overflow-y-auto cursor-text py-1 scrollbar-thin"
      onClick={onEditClick}
    >
      <div className="space-y-0.5 text-foreground/60">
        {parsedLines.map((line, lineIdx) =>
          line.segments.length > 0 ? (
            <div key={lineIdx} className="whitespace-pre-wrap">
              {line.segments.map((seg, segIdx) => renderSegment(seg, lineIdx, segIdx))}
            </div>
          ) : (
            <div key={lineIdx}>&nbsp;</div>
          )
        )}
      </div>
    </div>
  );
}
