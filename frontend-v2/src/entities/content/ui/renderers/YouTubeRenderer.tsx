import { Play } from 'lucide-react';
import type { CardRendererProps } from '../CardRendererRegistry';
import type { YouTubeMetadata } from '../../model/types';

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function YouTubeRenderer({ card, view }: CardRendererProps) {
  const meta = card.metadata as unknown as YouTubeMetadata | null | undefined;
  const channel = meta?.channel_title;
  const duration = meta?.duration_seconds;

  if (view === 'list' || view === 'compact') {
    return (
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        {channel && <span className="truncate max-w-[120px]">{channel}</span>}
        {channel && duration && <span>·</span>}
        {duration != null && (
          <span className="flex items-center gap-0.5 whitespace-nowrap">
            <Play className="w-2.5 h-2.5" aria-hidden="true" />
            {formatDuration(duration)}
          </span>
        )}
      </div>
    );
  }

  // grid / detail
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      {channel && <span className="truncate">{channel}</span>}
      {channel && duration && <span>·</span>}
      {duration != null && (
        <span className="flex items-center gap-0.5 whitespace-nowrap">
          <Play className="w-3 h-3" aria-hidden="true" />
          {formatDuration(duration)}
        </span>
      )}
    </div>
  );
}
