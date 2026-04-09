/**
 * Video title + channel + duration + cell badge.
 *
 * Design tokens: insighta-side-editor-mockup-v3.html
 */
import type { InsightCard } from '@/entities/card/model/types';

export interface PanelVideoInfoProps {
  card: InsightCard;
}

/** Format seconds to mm:ss. Returns null if no value. */
function formatDuration(seconds: number | undefined | null): string | null {
  if (seconds == null || seconds <= 0) return null;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function PanelVideoInfo({ card }: PanelVideoInfoProps) {
  const channel = card.metadata?.author || card.metadata?.siteName || null;
  const duration = formatDuration(card.lastWatchPosition);
  const hasCellBadge = card.mandalaId && card.cellIndex >= 0;

  return (
    <div className="shrink-0 border-b border-[rgba(255,255,255,0.04)] px-4 pb-2 pt-2.5">
      {/* Title */}
      <h2 className="line-clamp-2 text-[14px] font-bold leading-[1.35] tracking-[-0.2px] text-[#ededf0]">
        {card.title}
      </h2>

      {/* Meta line: channel . duration . cell badge */}
      <div className="mt-[3px] flex items-center gap-1.5 text-[11px] text-[#4e4f5c]">
        {channel && <span>{channel}</span>}
        {channel && duration && <Dot />}
        {duration && <span>{duration}</span>}
        {(channel || duration) && hasCellBadge && <Dot />}
        {hasCellBadge && (
          <span className="rounded-[4px] bg-[rgba(129,140,248,0.08)] px-1.5 py-px text-[10px] font-semibold text-[#818cf8]">
            {card.cellIndex}
          </span>
        )}
      </div>
    </div>
  );
}

/** 2px dot separator matching mockup `.panel-dot`. */
function Dot() {
  return (
    <span className="inline-block h-[2px] w-[2px] shrink-0 rounded-full bg-[#353642]" aria-hidden />
  );
}
