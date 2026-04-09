/**
 * Editor header: video context — compact, Notion-style.
 * Read-only. All data comes from the GET /rich-notes/:cardId response.
 */
import type { RichNoteMandalaCell, RichNoteVideoMeta } from '../lib/rich-note-api';

export interface EditorHeaderProps {
  video: RichNoteVideoMeta | null;
  mandalaCell: RichNoteMandalaCell | null;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds <= 0) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function EditorHeader({ video, mandalaCell }: EditorHeaderProps) {
  if (!video) {
    return (
      <div className="flex items-center gap-3">
        <div className="h-10 w-16 animate-pulse rounded bg-muted/40" />
        <div className="flex-1 space-y-1.5">
          <div className="h-3.5 w-3/4 animate-pulse rounded bg-muted/40" />
          <div className="h-2.5 w-1/2 animate-pulse rounded bg-muted/40" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      {video.thumbnail ? (
        <img
          src={video.thumbnail}
          alt=""
          className="h-10 w-16 flex-shrink-0 rounded object-cover"
        />
      ) : (
        <div className="h-10 w-16 flex-shrink-0 rounded bg-muted/40" />
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <h2 className="line-clamp-1 text-[13px] font-medium leading-snug text-foreground">
          {video.title || '제목 없음'}
        </h2>
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground/60">
          {video.channel && <span className="truncate">{video.channel}</span>}
          {formatDuration(video.durationSec) && (
            <>
              <span aria-hidden>·</span>
              <span>{formatDuration(video.durationSec)}</span>
            </>
          )}
          {mandalaCell && mandalaCell.cellIndex >= 0 && (
            <>
              <span aria-hidden>·</span>
              <span className="font-mono text-[10px]">
                cell {mandalaCell.cellIndex}
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
