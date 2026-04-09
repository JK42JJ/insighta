/**
 * Editor header: video thumbnail + title + channel + cell badge.
 * Read-only. All data comes from the GET /notes/rich response.
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
      <div className="flex items-center gap-3 border-b border-border pb-4">
        <div className="h-16 w-24 animate-pulse rounded bg-muted" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
          <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3 border-b border-border pb-4">
      {video.thumbnail ? (
        <img
          src={video.thumbnail}
          alt=""
          className="h-16 w-24 flex-shrink-0 rounded object-cover"
        />
      ) : (
        <div className="h-16 w-24 flex-shrink-0 rounded bg-muted" />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h2 className="line-clamp-2 text-sm font-semibold leading-tight text-foreground">
          {video.title || '제목 없음'}
        </h2>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
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
              <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide">
                cell {mandalaCell.cellIndex}
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
