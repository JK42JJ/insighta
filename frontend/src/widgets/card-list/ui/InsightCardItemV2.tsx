import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { useQueryClient } from '@tanstack/react-query';
import { InsightCard } from '@/entities/card/model/types';
import { Card } from '@/shared/ui/card';
import { cn } from '@/shared/lib/utils';
import { GripVertical, NotepadText, Loader2, RotateCw, Play, Heart, Archive } from 'lucide-react';
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
  // CP463 — when the SSE reports 'scored', the BE has just written the
  // new v2 row (mandala_relevance_pct + one_liner). useLikeCard.onSuccess
  // invalidated v2-summaries at enqueue time (too early — row didn't
  // exist yet), and useV2Summaries' 60s staleTime would otherwise hold
  // the empty payload until the next natural refetch. Force a refetch
  // here so the badge + footer one_liner appear the moment 'scored'
  // arrives.
  const queryClient = useQueryClient();
  useEffect(() => {
    if (enrichStream.phase === 'scored') {
      void queryClient.invalidateQueries({ queryKey: ['cards', 'v2-summaries'] });
    }
  }, [enrichStream.phase, queryClient]);

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
        // CP463 — outer glow / pulse removed per user directive
        // 2026-05-17: "수집중/분석중일때 카드가 심각하게 깜빡임. 매우
        // 어지러움 ... 카드 외곽하일라이트 > 하단 프로그래스로 수정".
        // Progress is now indicated by the legacy blue AI chip at
        // bottom-left[44px] (same module used for the YouTube D&D
        // enrichment flow); no more ring/animate-pulse on the card.
        isSelected && canDrag && 'cursor-grab active:cursor-grabbing',
        isDragging && 'opacity-30',
        className
      )}
    >
      {/* Drag handle — icon-only chrome-less (CP463 — matches the
          Heart / Archive language: drop-shadow for legibility,
          hover-only fade, hover:scale-125 + active:scale-95 for the
          same tactile response as the other corner affordances.
          No rotate on hover since a grip-handle tilting reads weird
          for a drag affordance; scale alone is enough. */}
      {canDrag && !isSelected && (
        <div
          {...listeners}
          data-dnd-handle
          className={cn(
            'absolute top-1.5 left-1.5 z-10 w-7 h-7 flex items-center justify-center',
            'opacity-0 group-hover:opacity-100',
            'transition-all duration-200 ease-out',
            'hover:scale-125 active:scale-95',
            'cursor-grab active:cursor-grabbing'
          )}
        >
          <GripVertical
            className="w-[20px] h-[20px] text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.85)]"
            strokeWidth={2.2}
            aria-hidden="true"
          />
        </div>
      )}

      {/* ── Thumbnail ── */}
      <div className="relative aspect-video overflow-hidden rounded-[10px] bg-gradient-to-br from-[#1a1c28] to-[#13141c] transition-[filter] duration-300 group-hover:brightness-[0.96] group-hover:contrast-[1.04]">
        <img
          src={upgradeYouTubeThumbnail(card.thumbnail) ?? card.thumbnail}
          alt={card.title}
          className="w-full h-full object-cover"
          loading="lazy"
          draggable={false}
          onError={handleThumbnailError}
          onLoad={handleThumbnailLoad}
        />

        {/* CP463+ — vignette-only hover: darken top + bottom edges so
            the white drop-shadowed icons (grip TL / Heart TR / Archive BL /
            progress dot BL) read clearly. via-transparent keeps the
            middle of the thumbnail untouched so the original artwork
            stays alive (user feedback: "전체가 시커멓게 되면 원본이 죽는 느낌"). */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-black/30 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />

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

        {/* CP463 — top-center 3-phase chip removed per user directive
            (깜빡 어지러움). Replaced by the legacy bottom-left blue AI
            chip (same component used for the YouTube D&D enrichment
            flow). See the BL chip below the Archive / memo indicator
            block. */}

        {/* Bottom-left: Archive (hover-only icon, no chrome). CP463 —
            hidden while a Heart-click enrichment is active so the
            progress chip can occupy the same BL corner without
            overlap. */}
        {videoId && card.mandalaId && !streamActive && (
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
                  ? 'text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.7)]'
                  : 'text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.85)]'
              )}
              fill={liked ? 'currentColor' : 'none'}
              strokeWidth={2.2}
              aria-hidden="true"
            />
          </button>
        )}

        {/* CP463 — Heart SSE / legacy enrichment progress chip. Sits in
            the BL corner (Archive is hidden while streamActive). Icon-
            only (no "AI" label per user directive 2026-05-17). Phase
            color encodes state:
              fetching  → blue-500  (준비)
              analyzing → amber-500 (진행중)
              scored    → emerald-500 (완료, transient ~2.5s)
            Legacy isEnriching prop falls into the blue fetching tier. */}
        {(streamActive || isEnriching) && (
          <div className="absolute bottom-2 left-2 z-[5] pointer-events-none">
            <div
              className={cn(
                // CP463 — minimal dot per user directive 2026-05-17
                // "보다 작게해서 점 형태로 하고 디밍으로 진행을 알리는
                // 건 어떨까?". 8×8 colored dot, dim (animate-pulse =
                // opacity 1 → 0.5 cycle) while in progress, stays
                // solid on scored.
                'w-2 h-2 rounded-full shadow-[0_1px_2px_rgba(0,0,0,0.5)]',
                streamPhase === 'scored'
                  ? 'bg-emerald-500'
                  : streamPhase === 'analyzing'
                    ? 'bg-blue-500 animate-pulse'
                    : 'bg-amber-500 animate-pulse'
              )}
              aria-label={
                streamPhase === 'scored'
                  ? '평가 완료'
                  : streamPhase === 'analyzing'
                    ? '분석 중'
                    : '준비 중'
              }
            />
          </div>
        )}

        {/* CP463 — failure Retry button moved to the footer meta row
            (right slot, where the % normally sits) per user directive
            2026-05-17. The BL thumbnail slot is reserved for the
            in-progress chip and the Archive icon. */}
      </div>

      {/* ── Body: title → blockquote → unified meta row ──
          CP463 unified design (2026-05-17 review):
          - Single secondary cluster (date · views · sector) on the
            left of the meta row, relevance % anchored to the right.
          - One-liner blockquote is subtle (border-muted/25, pl-2.5,
            10.5px, leading-relaxed) so it integrates instead of
            looking like a foreign component.
          - Consistent mt-2 between blocks for visual rhythm. */}
      <div className="px-3 pt-2 pb-4">
        <h4 className="text-[13px] font-semibold leading-[1.4] text-foreground line-clamp-2 tracking-[-0.1px]">
          {decodeHtmlEntities(card.title)}
        </h4>

        {trimmedOneLiner && (
          <blockquote className="mt-2 border-l-2 border-muted-foreground/25 pl-2.5 text-[10.5px] italic text-muted-foreground/75 leading-relaxed whitespace-pre-wrap break-words">
            {decodeHtmlEntities(trimmedOneLiner)}
          </blockquote>
        )}

        {(ytMeta.channelTitle ||
          footerLeft ||
          footerRight ||
          sectorLabel ||
          relevanceBadge ||
          isEnrichFailed ||
          showFailedGlow) && (
          <div className="mt-2 flex items-center justify-between gap-2 text-[10.5px] text-muted-foreground/70">
            <span className="truncate flex items-center gap-1.5 min-w-0">
              {(() => {
                // CP463 — inline meta: channel · date · views · sector.
                // Channel first (most identifying), foreground/80 so it
                // reads slightly stronger than the rest of the row.
                const parts: { key: string; node: React.ReactNode }[] = [];
                if (ytMeta.channelTitle)
                  parts.push({
                    key: 'ch',
                    node: (
                      <span className="truncate text-foreground/80">{ytMeta.channelTitle}</span>
                    ),
                  });
                if (footerLeft)
                  parts.push({
                    key: 'date',
                    node: <span className="truncate">{footerLeft}</span>,
                  });
                if (footerRight)
                  parts.push({
                    key: 'views',
                    node: <span className="shrink-0 tabular-nums">{footerRight}</span>,
                  });
                if (sectorLabel)
                  parts.push({
                    key: 'sector',
                    node: <span className="truncate">{sectorLabel}</span>,
                  });
                return parts.flatMap((p, i) =>
                  i === 0
                    ? [<React.Fragment key={p.key}>{p.node}</React.Fragment>]
                    : [
                        <span key={`${p.key}-sep`} aria-hidden="true">
                          ·
                        </span>,
                        <React.Fragment key={p.key}>{p.node}</React.Fragment>,
                      ]
                );
              })()}
            </span>
            {/* CP463 — right slot priority:
                  failure  → Retry icon (user directive 2026-05-17:
                            "재시도 아이콘이 현재 관련도 비율 위치에")
                  scored   → relevance % (color-tiered)
                  else     → empty */}
            {!streamActive && !isEnriching && (isEnrichFailed || showFailedGlow) ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (showFailedGlow && videoId) {
                    void enrichStream.open(videoId);
                  } else {
                    onRetryEnrich?.(card.id, card.videoUrl);
                  }
                }}
                className="shrink-0 text-destructive hover:text-destructive/80 transition-colors cursor-pointer"
                aria-label="Retry enrichment"
              >
                <RotateCw className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            ) : relevanceBadge ? (
              <span
                className={cn(
                  'text-[10.5px] font-semibold shrink-0 tabular-nums',
                  relevanceBadge.className
                )}
              >
                {relevanceBadge.label}
              </span>
            ) : null}
          </div>
        )}
      </div>
    </Card>
  );
}
