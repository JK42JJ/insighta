import { Play } from 'lucide-react';
import { handleThumbnailError } from '@/shared/lib/image-utils';
import type { RecommendationItem } from '../model/useRecommendations';

interface FeedCardProps {
  item: RecommendationItem;
  onClick?: (item: RecommendationItem) => void;
}

const SCORE_PCT_MULTIPLIER = 100;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;

function formatDuration(seconds: number | null): string {
  if (seconds == null || seconds <= 0) return '';
  if (seconds >= SECONDS_PER_HOUR) {
    const h = Math.floor(seconds / SECONDS_PER_HOUR);
    const m = Math.floor((seconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
    return `${h}:${String(m).padStart(2, '0')}`;
  }
  const m = Math.floor(seconds / SECONDS_PER_MINUTE);
  const s = seconds % SECONDS_PER_MINUTE;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function FeedCard({ item, onClick }: FeedCardProps) {
  const isAuto = item.source === 'auto_recommend';
  const duration = formatDuration(item.durationSec);
  const scorePct = Math.round(item.recScore * SCORE_PCT_MULTIPLIER);

  return (
    <button
      type="button"
      onClick={() => onClick?.(item)}
      className={`group flex items-center gap-3 w-full text-left bg-surface-low hover:bg-surface-mid border border-border/50 hover:border-primary/60 rounded-lg p-2.5 transition-colors ${
        isAuto ? 'border-l-[3px] border-l-emerald-500/70' : ''
      }`}
    >
      {/* Thumbnail */}
      <div className="relative w-[110px] h-[62px] rounded-md overflow-hidden bg-muted shrink-0">
        {item.thumbnail ? (
          <img
            src={item.thumbnail}
            alt=""
            className="w-full h-full object-cover"
            onError={handleThumbnailError}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[9px] text-muted-foreground">
            no thumb
          </div>
        )}
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <Play className="w-5 h-5 text-white" fill="white" />
        </div>
        {duration && (
          <span className="absolute bottom-1 right-1 px-1 py-px rounded-sm bg-black/80 text-[9px] font-semibold text-white tabular-nums">
            {duration}
          </span>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-[12.5px] font-medium leading-snug text-foreground line-clamp-2">
          {item.title}
        </p>
        <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
          {item.channel && <span className="truncate max-w-[140px]">{item.channel}</span>}
          {item.cellLabel && (
            <>
              <span>·</span>
              <span className="text-primary font-medium truncate max-w-[100px]">
                {item.cellLabel}
              </span>
            </>
          )}
          <span>·</span>
          <span className="text-emerald-500 font-bold tabular-nums">{scorePct}</span>
          {isAuto && (
            <>
              <span>·</span>
              <span className="text-emerald-500 font-medium">자동</span>
            </>
          )}
        </div>
      </div>
    </button>
  );
}
