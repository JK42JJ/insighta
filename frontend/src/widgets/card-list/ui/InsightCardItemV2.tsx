import { useCallback } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { InsightCard } from '@/entities/card/model/types';
import { Card } from '@/shared/ui/card';
import { cn } from '@/shared/lib/utils';
import { GripVertical, NotepadText, Loader2, RotateCw } from 'lucide-react';
import { type DragData, cardDragId } from '@/shared/lib/dnd';
import { upgradeYouTubeThumbnail, handleThumbnailError } from '@/shared/lib/image-utils';

// ── Constants ──────────────────────────────────────────────

const QUALITY_BADGE_THRESHOLD_HIGH = 90;
const QUALITY_BADGE_THRESHOLD_MID = 80;
const QUALITY_BADGE_THRESHOLD_LOW = 70;
const SCORE_SCALE = 100;

const VIEW_COUNT_BILLION = 1_000_000_000;
const VIEW_COUNT_MILLION = 1_000_000;
const VIEW_COUNT_THOUSAND = 1_000;

const RELATIVE_MINUTE_SEC = 60;
const RELATIVE_HOUR_SEC = 3600;
const RELATIVE_DAY_MS = 86_400_000;
const RELATIVE_WEEK_DAYS = 7;
const RELATIVE_MONTH_DAYS = 30;
const RELATIVE_YEAR_DAYS = 365;

// ── Helpers ────────────────────────────────────────────────

function formatDuration(sec: number | null | undefined): string | null {
  if (sec == null || sec <= 0) return null;
  const h = Math.floor(sec / RELATIVE_HOUR_SEC);
  const m = Math.floor((sec % RELATIVE_HOUR_SEC) / RELATIVE_MINUTE_SEC);
  const s = Math.floor(sec % RELATIVE_MINUTE_SEC);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatViewCount(count: number | null | undefined): string | null {
  if (count == null || count <= 0) return null;
  if (count >= VIEW_COUNT_BILLION) return `${(count / VIEW_COUNT_BILLION).toFixed(1)}B`;
  if (count >= VIEW_COUNT_MILLION) return `${(count / VIEW_COUNT_MILLION).toFixed(1)}M`;
  if (count >= VIEW_COUNT_THOUSAND) return `${(count / VIEW_COUNT_THOUSAND).toFixed(1)}K`;
  return String(count);
}

function formatRelativeDate(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return null;
  const diffMs = Date.now() - date.getTime();
  const diffDays = Math.floor(diffMs / RELATIVE_DAY_MS);
  if (diffDays < 1) return 'Today';
  if (diffDays < RELATIVE_WEEK_DAYS) return `${diffDays}d ago`;
  if (diffDays < RELATIVE_MONTH_DAYS) return `${Math.floor(diffDays / RELATIVE_WEEK_DAYS)}w ago`;
  if (diffDays < RELATIVE_YEAR_DAYS) return `${Math.floor(diffDays / RELATIVE_MONTH_DAYS)}mo ago`;
  return `${Math.floor(diffDays / RELATIVE_YEAR_DAYS)}y ago`;
}

function getQualityBadge(
  score: number | null | undefined
): { label: string; className: string } | null {
  if (score == null || score <= 0) return null;
  const displayScore = Math.round(score * SCORE_SCALE);
  if (displayScore < QUALITY_BADGE_THRESHOLD_LOW) return null;
  if (displayScore >= QUALITY_BADGE_THRESHOLD_HIGH)
    return { label: String(displayScore), className: 'bg-[#818cf8] text-white' };
  if (displayScore >= QUALITY_BADGE_THRESHOLD_MID)
    return { label: String(displayScore), className: 'bg-[#34d399] text-[#0a1a14]' };
  return { label: String(displayScore), className: 'bg-[#fbbf24] text-[#1a1400]' };
}

/** Extract YouTube metadata from InsightCard.metadata (runtime fields beyond UrlMetadata type) */
function extractYouTubeMeta(card: InsightCard) {
  const meta = card.metadata as unknown as Record<string, unknown> | undefined;
  return {
    channelTitle: (meta?.channel_title as string) ?? (meta?.siteName as string) ?? null,
    durationSec: (meta?.duration_seconds as number) ?? null,
    viewCount: (meta?.view_count as number) ?? null,
    publishedAt: (meta?.published_at as string) ?? null,
  };
}

// ── Types ──────────────────────────────────────────────────

interface InsightCardItemV2Props {
  card: InsightCard;
  onCardClick?: () => void;
  onCtrlClick?: (e: React.MouseEvent) => void;
  isDraggable?: boolean;
  selectedCardIds?: Set<string>;
  className?: string;
  isEnriching?: boolean;
  isEnrichFailed?: boolean;
  onRetryEnrich?: (cardId: string, videoUrl?: string) => void;
  /** Optional quality score 0-1 (from rec_score). Overrides metadata extraction. */
  recScore?: number | null;
}

// ── Component ──────────────────────────────────────────────

export function InsightCardItemV2({
  card,
  onCardClick,
  onCtrlClick,
  isDraggable: canDrag = false,
  selectedCardIds,
  className,
  isEnriching = false,
  isEnrichFailed = false,
  onRetryEnrich,
  recScore,
}: InsightCardItemV2Props) {
  const isSelected = selectedCardIds?.has(card.id) ?? false;
  const isMultiSelect = isSelected && selectedCardIds && selectedCardIds.size > 1;
  const dragData: DragData = isMultiSelect
    ? { type: 'card', card, selectedCardIds: [...selectedCardIds!] }
    : { type: 'card-reorder', card };

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: cardDragId(card.id),
    data: dragData,
    disabled: !canDrag,
  });

  const cardListeners = isSelected ? listeners : undefined;

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if ((e.ctrlKey || e.metaKey) && onCtrlClick) {
        onCtrlClick(e);
        return;
      }
      onCardClick?.();
    },
    [onCardClick, onCtrlClick]
  );

  // ── Data extraction ──
  const ytMeta = extractYouTubeMeta(card);
  const effectiveScore = recScore ?? null;
  const qualityBadge = getQualityBadge(effectiveScore);
  const duration = formatDuration(ytMeta.durationSec);
  const views = formatViewCount(ytMeta.viewCount);
  const relDate = formatRelativeDate(ytMeta.publishedAt ?? card.createdAt?.toISOString());
  const hasNote = !!card.userNote?.trim();
  const isYouTube = card.linkType === 'youtube' || card.linkType === 'youtube-shorts';

  // ── Meta segments (channel · views · date) ──
  const metaSegments: string[] = [];
  if (ytMeta.channelTitle) metaSegments.push(ytMeta.channelTitle);
  if (views) metaSegments.push(views);
  if (relDate) metaSegments.push(relDate);

  return (
    <Card
      ref={setNodeRef}
      {...(canDrag ? { ...attributes, ...cardListeners } : {})}
      data-dnd-draggable={isSelected ? '' : undefined}
      data-card-content
      onClick={handleClick}
      className={cn(
        'group relative cursor-pointer transition-all duration-200',
        'border-0 shadow-none bg-transparent rounded-[10px]',
        isSelected && canDrag && 'cursor-grab active:cursor-grabbing',
        isDragging && 'opacity-30',
        className
      )}
    >
      {/* Drag handle — grip icon for non-selected cards */}
      {canDrag && !isSelected && (
        <div
          {...listeners}
          data-dnd-handle
          className="absolute top-2 left-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing"
        >
          <div className="bg-black/60 backdrop-blur-sm rounded p-0.5">
            <GripVertical className="w-3 h-3 text-white/70" aria-hidden="true" />
          </div>
        </div>
      )}

      {/* ── Thumbnail ── */}
      <div className="relative aspect-video overflow-hidden rounded-[10px] bg-gradient-to-br from-[#1a1c28] to-[#13141c] group-hover:brightness-105 transition-[filter] duration-200">
        <img
          src={upgradeYouTubeThumbnail(card.thumbnail) ?? card.thumbnail}
          alt={card.title}
          className="w-full h-full object-cover"
          loading="lazy"
          onError={handleThumbnailError}
        />

        {/* Top-left: Quality badge */}
        {qualityBadge && (
          <span
            className={cn(
              'absolute top-2 left-2 text-[10px] font-bold px-[7px] py-[2px] rounded',
              qualityBadge.className
            )}
          >
            {qualityBadge.label}
          </span>
        )}

        {/* Top-right: Source badge */}
        {isYouTube && (
          <span className="absolute top-2 right-2 text-[9px] font-semibold px-1.5 py-[2px] rounded-[3px] bg-black/60 backdrop-blur text-white/60 flex items-center gap-[3px]">
            <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <polygon points="5,3 19,12 5,21" />
            </svg>
            YouTube
          </span>
        )}

        {/* Bottom-left: Memo indicator (only if note exists) */}
        {hasNote && (
          <div className="absolute bottom-1.5 left-1.5 w-6 h-5 rounded bg-black/60 backdrop-blur flex items-center justify-center">
            <NotepadText
              className="w-[13px] h-[13px] text-white/70"
              strokeWidth={1.8}
              aria-hidden="true"
            />
          </div>
        )}

        {/* Bottom-right: Duration */}
        {duration && (
          <span className="absolute bottom-1.5 right-1.5 text-[10px] font-mono font-medium px-[5px] py-[2px] rounded bg-black/75 text-white/85">
            {duration}
          </span>
        )}

        {/* Enriching spinner */}
        {isEnriching && (
          <div className="absolute bottom-1.5 left-1.5 z-[5] pointer-events-none">
            <div className="flex items-center gap-1 bg-blue-500/90 text-white text-[10px] px-1.5 py-0.5 rounded-full">
              <Loader2 className="w-3 h-3 animate-spin" />
              <span>AI</span>
            </div>
          </div>
        )}

        {/* Enrich failed */}
        {isEnrichFailed && !isEnriching && (
          <div className="absolute bottom-1.5 left-1.5 z-[5]">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRetryEnrich?.(card.id, card.videoUrl);
              }}
              className="flex items-center gap-1 bg-destructive/90 hover:bg-destructive text-white text-[10px] px-1.5 py-0.5 rounded-full transition-colors cursor-pointer"
            >
              <RotateCw className="w-3 h-3" />
              <span>Retry</span>
            </button>
          </div>
        )}
      </div>

      {/* ── Body: title + meta ── */}
      <div className="px-[2px] pt-2 pb-1">
        <h4 className="text-[13px] font-semibold leading-[1.4] text-foreground line-clamp-2 tracking-[-0.1px]">
          {card.title}
        </h4>
        {metaSegments.length > 0 && (
          <p className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1 truncate">
            {metaSegments.map((seg, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && (
                  <span className="w-[2px] h-[2px] rounded-full bg-muted-foreground/40 shrink-0" />
                )}
                <span className="truncate">{seg}</span>
              </span>
            ))}
          </p>
        )}
      </div>
    </Card>
  );
}
