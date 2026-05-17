import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { InsightCard } from '@/entities/card/model/types';
import { Card } from '@/shared/ui/card';
import { cn } from '@/shared/lib/utils';
import {
  GripVertical,
  NotepadText,
  Loader2,
  RotateCw,
  Play,
  Heart,
  Archive,
  Check,
  AlertTriangle,
} from 'lucide-react';
import { useLikeCard } from '@/features/card-management/model/useLikeCard';
import { useArchiveCard } from '@/features/card-management/model/useArchiveCard';
import { useEnrichStream } from '@/features/card-management/model/useEnrichStream';
import { extractYouTubeVideoId } from '@/shared/lib/url-normalize';
import { type DragData, cardDragId } from '@/shared/lib/dnd';
import {
  upgradeYouTubeThumbnail,
  handleThumbnailError,
  handleThumbnailLoad,
} from '@/shared/lib/image-utils';
import { formatRelativeDate } from '@/shared/lib/format-date';
import { decodeHtmlEntities } from '@/shared/lib/decode-html-entities';

// ── Constants ──────────────────────────────────────────────

const QUALITY_BADGE_THRESHOLD_HIGH = 90;
const QUALITY_BADGE_THRESHOLD_MID = 80;
const QUALITY_BADGE_THRESHOLD_LOW = 70;
// CP463 — Heart'd cards always show the % badge regardless of score
// (user directive 2026-05-17: "하트 선택된 내용은 관련도가 백분율로
// 표기되어야해"). Color stays score-tiered (high/mid/low) but the
// previous "hide below 70" cut-off is dropped — a 50 or 60 score still
// renders, just in the lower-tier color.

const VIEW_COUNT_BILLION = 1_000_000_000;
const VIEW_COUNT_MILLION = 1_000_000;
const VIEW_COUNT_THOUSAND = 1_000;

const RELATIVE_MINUTE_SEC = 60;
const RELATIVE_HOUR_SEC = 3600;

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

/**
 * Quality badge built from the CP462+ `mandala_relevance_pct` (0-100,
 * Heart'd cards only). The generic rec_score badge was retired per
 * handoff decision #8: only Heart'd cards earn a TL badge.
 */
function getMandalaRelevanceBadge(
  pct: number | null | undefined
): { label: string; className: string } | null {
  if (pct == null) return null;
  const value = Math.max(0, Math.min(100, Math.round(pct)));
  const label = `${value}%`;
  // CP463 — user directive 2026-05-17: "관련도 는 배지가 아닌 텍스트
  // (비율별 칼라 다르게 적용)". Drop the background/padding/rounded
  // chrome; keep only the per-tier text color so the relevance reads
  // as plain coloured text in the footer row.
  if (value >= QUALITY_BADGE_THRESHOLD_HIGH) return { label, className: 'text-[#818cf8]' };
  if (value >= QUALITY_BADGE_THRESHOLD_MID) return { label, className: 'text-[#34d399]' };
  if (value >= QUALITY_BADGE_THRESHOLD_LOW) return { label, className: 'text-[#fbbf24]' };
  return { label, className: 'text-[#94a3b8]' };
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

function safeExtractVideoId(videoUrl: string): string | null {
  try {
    return extractYouTubeVideoId(new URL(videoUrl));
  } catch {
    return null;
  }
}

// ── Types ──────────────────────────────────────────────────

interface InsightCardItemV2Props {
  card: InsightCard;
  onCardClick?: () => void;
  onCtrlClick?: (e: React.MouseEvent) => void;
  isDraggable?: boolean;
  selectedCardIds?: Set<string>;
  className?: string;
  /**
   * Legacy enrichment indicator (separate from the Heart-click v2
   * stream). Preserved for older callers that drive the blue "AI"
   * pulse via prop. The Heart flow uses its own `useEnrichStream`
   * subscription inside the card.
   */
  isEnriching?: boolean;
  isEnrichFailed?: boolean;
  onRetryEnrich?: (cardId: string, videoUrl?: string) => void;
  /**
   * CP462+ Issue #649 — mandala-relevance fit score (0-100). Sourced
   * from `video_rich_summaries.mandala_relevance_pct` via the batch
   * /v2-summaries endpoint. Renders the TL badge only when non-null
   * (i.e. the user has Heart'd this video and v2 has scored it).
   */
  mandalaRelevancePct?: number | null;
  /**
   * CP462+ Issue #649 — v2 `core.one_liner` (≤ 20 chars). Renders as
   * italic line-clamp-1 below the title only when non-empty (Heart'd
   * cards with a passed v2 row).
   */
  oneLiner?: string | null;
  /**
   * Optional archive callback. The card calls this AFTER the archive
   * mutation succeeds so the parent can present a 5-second undo
   * toast (handoff decision #6 — soft hide). When omitted, the card
   * still records the signal but the toast is suppressed.
   */
  onArchived?: (videoId: string) => void;
  /**
   * CP463 — mandala sector label (currentLevel.subjects[cellIndex]).
   * Renders on the left side of the new footer row paired with the
   * relevance % badge on the right.
   */
  sectorLabel?: string | null;
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
  mandalaRelevancePct,
  oneLiner,
  onArchived,
  sectorLabel,
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

  // CP462+ Issue #649 — Heart subsumes the old Pin role (pinned_at is
  // still set server-side as the auto-eviction guard, but the UI no
  // longer exposes a separate Pin button per handoff decision #3).
  const videoId = useMemo(() => safeExtractVideoId(card.videoUrl), [card.videoUrl]);
  // Optimistic local override — server pinned_at is the truth of record,
  // but TanStack invalidation has a refetch latency. Without an optimistic
  // flip the user can re-click before pinned_at has propagated and the
  // hook still sees `liked=true`, looking like the toggle was ignored.
  // The effect below clears the local override only when the server has
  // CAUGHT UP (server-state === local), so an immediate clear in
  // onSuccess does not let the stale `card.pinnedAt` snap the heart
  // straight back to its previous state.
  const [likedLocal, setLikedLocal] = useState<boolean | null>(null);
  const serverLiked = Boolean(card.pinnedAt);
  const liked = likedLocal ?? serverLiked;
  useEffect(() => {
    if (likedLocal !== null && serverLiked === likedLocal) {
      setLikedLocal(null);
    }
  }, [likedLocal, serverLiked]);
  const { like, unlike } = useLikeCard();
  const { archive } = useArchiveCard();
  const enrichStream = useEnrichStream();

  const handleHeartClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      if (!videoId) return;
      if (liked) {
        setLikedLocal(false);
        unlike.mutate(videoId, {
          // No onSuccess clear — the effect above clears likedLocal
          // once the refetched card.pinnedAt catches up to `false`.
          onError: () => setLikedLocal(true), // rollback to previous true
        });
        return;
      }
      setLikedLocal(true);
      like.mutate(
        {
          videoId,
          mandalaId: card.mandalaId ?? undefined,
          title: card.title,
        },
        {
          onSuccess: () => {
            // Open the SSE only when the BE actually enqueued a job
            // (which requires mandalaId; like without mandalaId still
            // records the signal but skips v2 enrichment).
            if (card.mandalaId) {
              void enrichStream.open(videoId);
            }
          },
          onError: () => setLikedLocal(false), // rollback to previous false
        }
      );
    },
    [card.mandalaId, card.title, enrichStream, like, liked, unlike, videoId]
  );

  const handleArchiveClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      if (!videoId || !card.mandalaId) return;
      archive.mutate(
        { videoId, mandalaId: card.mandalaId },
        {
          onSuccess: () => {
            onArchived?.(videoId);
          },
        }
      );
    },
    [archive, card.mandalaId, onArchived, videoId]
  );

  // CP446 — restore B-model: card body carries listeners only when the card
  // is already selected (multi-drag). Non-selected card bodies stay free for
  // drag-to-select (useDragSelect.isDndActivator returns false). Drag-to-move
  // a single non-selected card uses the visible 24×24 grip handle.
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
  const relevanceBadge = getMandalaRelevanceBadge(mandalaRelevancePct);
  const duration = formatDuration(ytMeta.durationSec);
  const views = formatViewCount(ytMeta.viewCount);
  const relDate = formatRelativeDate(ytMeta.publishedAt ?? card.createdAt?.toISOString());
  const hasNote = !!card.userNote?.trim();
  const trimmedOneLiner = oneLiner?.trim();

  const footerLeft = relDate || null;
  const footerRight = views || null;

  // 3-phase animation phase from the Heart-click SSE stream (idle for
  // non-active cards). The legacy `isEnriching` / `isEnrichFailed`
  // props still drive their own indicators; the new stream wins when
  // both are active (Heart click is more user-visible).
  const streamPhase = enrichStream.phase;
  const streamActive = enrichStream.isActive;
  const showAnalyzingGlow = streamActive && streamPhase === 'analyzing';
  const showScoredFlash = streamPhase === 'scored';
  const showFailedGlow = streamPhase === 'failed' || streamPhase === 'timeout';

  return (
    <Card
      ref={setNodeRef}
      {...(canDrag ? { ...attributes, ...cardListeners } : {})}
      data-dnd-draggable={isSelected ? '' : undefined}
      data-card-content
      onClick={handleClick}
      onDragStart={(e) => e.preventDefault()}
      className={cn(
        'group relative cursor-pointer transition-all duration-200',
        'border-0 shadow-none bg-transparent rounded-[10px]',
        'hover:-translate-y-0.5 hover:ring-1 hover:ring-border/60',
        'w-[95%]',
        // CP462+ Issue #649 — 3-phase glow overlay. Wraps the whole
        // card (not just the thumbnail) so the visual feedback is
        // unmistakable even on smaller tiles.
        showAnalyzingGlow && 'ring-2 ring-emerald-500/60 animate-pulse',
        showScoredFlash && 'ring-2 ring-emerald-500/80',
        showFailedGlow && 'ring-2 ring-destructive/60',
        isSelected && canDrag && 'cursor-grab active:cursor-grabbing',
        isDragging && 'opacity-30',
        className
      )}
    >
      {/* Drag handle — visible grip for non-selected cards (24×24 hit area). */}
      {canDrag && !isSelected && (
        <div
          {...listeners}
          data-dnd-handle
          className="absolute top-2 left-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing"
        >
          <div className="w-6 h-6 flex items-center justify-center bg-black/60 backdrop-blur-sm rounded">
            <GripVertical className="w-5 h-5 text-white/70" aria-hidden="true" />
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
          draggable={false}
          onError={handleThumbnailError}
          onLoad={handleThumbnailLoad}
        />

        {/* Hover dim overlay */}
        <div className="absolute inset-0 bg-black/10 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none" />

        {/* Glass-morphism Play badge */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none">
          <div className="w-12 h-12 rounded-full bg-white/15 backdrop-blur-md border border-white/30 flex items-center justify-center shadow-md">
            <Play className="w-6 h-6 text-white fill-white translate-x-[1px]" aria-hidden="true" />
          </div>
        </div>

        {/* CP463 — TL relevance badge moved to the new footer row
            (sector ◀ ▶ relevance %). The thumbnail TL slot is now free. */}

        {/* Top-right: Duration (moved from BR — Pin slot retired) */}
        {duration && (
          <span className="absolute top-1.5 right-1.5 text-[10px] font-mono font-medium px-[5px] py-[2px] rounded bg-black/75 text-white/85">
            {duration}
          </span>
        )}

        {/* Center-top chip — Heart-click 3-phase animation (live SSE) */}
        {streamActive && (
          <div className="absolute top-1.5 left-1/2 -translate-x-1/2 z-[6] pointer-events-none">
            <div className="flex items-center gap-1 bg-emerald-500/95 text-white text-[10px] px-2 py-0.5 rounded-full shadow-sm">
              <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
              <span>
                {streamPhase === 'fetching'
                  ? '수집 중'
                  : streamPhase === 'analyzing'
                    ? '분석 중'
                    : '준비 중'}
              </span>
            </div>
          </div>
        )}
        {showScoredFlash && (
          <div className="absolute top-1.5 left-1/2 -translate-x-1/2 z-[6] pointer-events-none">
            <div className="flex items-center gap-1 bg-emerald-500/95 text-white text-[10px] px-2 py-0.5 rounded-full shadow-sm">
              <Check className="w-3 h-3" aria-hidden="true" />
              <span>평가 완료</span>
            </div>
          </div>
        )}
        {showFailedGlow && (
          <div className="absolute top-1.5 left-1/2 -translate-x-1/2 z-[6]">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (videoId) void enrichStream.open(videoId);
              }}
              className="flex items-center gap-1 bg-destructive/90 hover:bg-destructive text-white text-[10px] px-2 py-0.5 rounded-full transition-colors cursor-pointer"
            >
              <AlertTriangle className="w-3 h-3" aria-hidden="true" />
              <span>다시 시도</span>
            </button>
          </div>
        )}

        {/* Bottom-left: Archive (hover-only icon, no chrome) — soft hide within mandala.
            CP463 user directive 2026-05-17: "아카이브/하트는 배경은 제거하고
            아이콘만 표기하되 호버시 사용자가 인지 가능한 수준의 애니메이션
            을 제공할것." Icon-only with drop-shadow for legibility over
            the thumbnail, scale-125 + rotate on hover. */}
        {videoId && card.mandalaId && (
          <button
            type="button"
            onClick={handleArchiveClick}
            aria-label="Archive card"
            disabled={archive.isPending}
            className={cn(
              'absolute bottom-1.5 left-1.5 z-10 w-7 h-7 flex items-center justify-center',
              'opacity-0 group-hover:opacity-100',
              'transition-all duration-200 ease-out',
              'hover:scale-125 hover:-rotate-6 active:scale-95',
              'disabled:opacity-50 disabled:cursor-not-allowed'
            )}
          >
            <Archive
              className="w-[20px] h-[20px] text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.85)]"
              strokeWidth={2.2}
              aria-hidden="true"
            />
          </button>
        )}

        {/* Bottom-left (alt): Memo indicator — shifts up when Archive is visible */}
        {hasNote && (
          <div
            className={cn(
              'absolute w-6 h-5 rounded bg-black/60 backdrop-blur flex items-center justify-center pointer-events-none',
              videoId && card.mandalaId ? 'bottom-[44px] left-1.5' : 'bottom-1.5 left-1.5'
            )}
          >
            <NotepadText
              className="w-[13px] h-[13px] text-white/70"
              strokeWidth={1.8}
              aria-hidden="true"
            />
          </div>
        )}

        {/* Bottom-right: Heart (Pin replacement). Icon-only (no chrome)
            per CP463 user directive 2026-05-17. Liked = always-visible
            red fill; unliked = hover-only white. Hover animates scale-125
            + slight rotate so the affordance is unmistakable. */}
        {videoId && (
          <button
            type="button"
            onClick={handleHeartClick}
            aria-label={liked ? 'Unlike card' : 'Like card'}
            aria-pressed={liked}
            disabled={like.isPending || unlike.isPending}
            className={cn(
              'absolute bottom-1.5 right-1.5 z-10 w-7 h-7 flex items-center justify-center',
              liked ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
              'transition-all duration-200 ease-out',
              'hover:scale-125 hover:rotate-6 active:scale-95',
              'disabled:opacity-50 disabled:cursor-not-allowed'
            )}
          >
            <Heart
              className={cn(
                'w-[22px] h-[22px]',
                liked
                  ? 'text-red-500 drop-shadow-[0_1px_3px_rgba(0,0,0,0.55)]'
                  : 'text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.85)]'
              )}
              fill={liked ? 'currentColor' : 'none'}
              strokeWidth={2.2}
              aria-hidden="true"
            />
          </button>
        )}

        {/* Legacy enriching spinner (separate from Heart SSE) */}
        {isEnriching && !streamActive && (
          <div className="absolute bottom-1.5 left-[44px] z-[5] pointer-events-none">
            <div className="flex items-center gap-1 bg-blue-500/90 text-white text-[10px] px-1.5 py-0.5 rounded-full">
              <Loader2 className="w-3 h-3 animate-spin" />
              <span>AI</span>
            </div>
          </div>
        )}

        {/* Legacy enrich failed — Retry button */}
        {isEnrichFailed && !isEnriching && !streamActive && (
          <div className="absolute bottom-1.5 left-[44px] z-[5]">
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

      {/* ── Body: title + meta + (optional) one_liner + sector/relevance row ── */}
      <div className="px-3 pt-2 pb-4">
        <h4 className="text-[13px] font-semibold leading-[1.4] text-foreground line-clamp-2 tracking-[-0.1px]">
          {decodeHtmlEntities(card.title)}
        </h4>
        {(footerLeft || footerRight) && (
          <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
            <span className="truncate">{footerLeft ?? ''}</span>
            <span className="shrink-0 ml-2">{footerRight ?? ''}</span>
          </div>
        )}
        {/* CP463 — one_liner moved below date/views per user directive
            "요약정보는 카드의 기간/조회수 아래에 배치해줘" (2026-05-17),
            and rendered in full (no line-clamp / no '…' truncation —
            wrap as needed) per follow-up directive same date:
            "요약정보에 ... 표기하지말고 전체 내용모두 표기 (줄바꿈
            되어도 관찮아)". */}
        {trimmedOneLiner && (
          <p className="mt-1 text-[11px] italic text-muted-foreground leading-snug whitespace-pre-wrap break-words">
            {decodeHtmlEntities(trimmedOneLiner)}
          </p>
        )}
        {/* CP463 — new footer row: sector (left) + relevance % (right).
            Only renders when either side has content so unrelated cards
            don't get an empty row. */}
        {(sectorLabel || relevanceBadge) && (
          <div className="mt-1.5 flex items-center justify-between gap-2 min-h-[18px]">
            {sectorLabel ? (
              <span className="text-[10px] font-medium text-muted-foreground/80 truncate max-w-[60%]">
                {sectorLabel}
              </span>
            ) : (
              <span />
            )}
            {relevanceBadge && (
              <span
                className={cn(
                  'text-[10px] font-semibold shrink-0 tabular-nums',
                  relevanceBadge.className
                )}
              >
                {relevanceBadge.label}
              </span>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
