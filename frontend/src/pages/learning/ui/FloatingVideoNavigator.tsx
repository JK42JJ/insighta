import { useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, GalleryHorizontalEnd, X } from 'lucide-react';
import { useMandalaCards } from '../model/useMandalaCards';
import { cn } from '@/shared/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip';

/**
 * Floating video navigator (video-view mockup track) — collapsed: a round
 * pill button with the current position badge; click expands a horizontal
 * thumbnail strip for prev/next hops + rough position. Hover on a thumb
 * shows a LARGE thumbnail preview so neighbors are visually identifiable.
 * Click-to-expand by design: player hover is reserved for the scrubber,
 * and hover-in-hover (strip + preview tooltip) would misfire on trackpads.
 */

interface FloatingVideoNavigatorProps {
  mandalaId: string;
  currentVideoId: string;
  /** Controlled expand state — parent hides the breadcrumb while expanded. */
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
}

const SCROLL_AMOUNT = 240;
const YT_ID_RE = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/;

export function FloatingVideoNavigator({
  mandalaId,
  currentVideoId,
  expanded,
  onExpandedChange,
}: FloatingVideoNavigatorProps) {
  const navigate = useNavigate();
  const { cards } = useMandalaCards(mandalaId);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const videos = cards
    .map((c) => ({ ...c, ytId: c.videoUrl.match(YT_ID_RE)?.[1] ?? null }))
    .filter((c) => c.ytId);
  const currentIdx = videos.findIndex((v) => v.ytId === currentVideoId);

  // Outside-close uses `click` (not mousedown) — CP443: avoids races with
  // TipTap / dnd-kit pointerdown paths.
  useEffect(() => {
    if (!expanded) return;
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onExpandedChange(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onExpandedChange(false);
    }
    // Defer attach one tick — the expanding click's own bubble would otherwise
    // hit document with the (now-unmounted) collapsed button as target →
    // contains() false → instant re-collapse.
    const timerId = window.setTimeout(() => {
      document.addEventListener('click', onClick);
    }, 0);
    document.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(timerId);
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [expanded, onExpandedChange]);

  // Center the active thumb when the strip opens or the video changes.
  useEffect(() => {
    if (!expanded) return;
    const activeEl = scrollRef.current?.querySelector('[data-active="true"]');
    activeEl?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [expanded, currentVideoId]);

  const scroll = useCallback((direction: 'left' | 'right') => {
    scrollRef.current?.scrollBy({
      left: direction === 'left' ? -SCROLL_AMOUNT : SCROLL_AMOUNT,
      behavior: 'smooth',
    });
  }, []);

  if (videos.length <= 1) return null;

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => onExpandedChange(true)}
        aria-expanded={false}
        aria-label="영상 네비게이터 열기"
        className="flex h-9 shrink-0 items-center gap-2 rounded-full border border-[var(--lp-line-8)] bg-[var(--lp-surface-2)] pl-2.5 pr-3 text-[var(--lp-dim)] transition-colors hover:text-[var(--lp-strong)]"
      >
        <GalleryHorizontalEnd className="h-4 w-4" aria-hidden />
        <span className="text-[11.5px] font-semibold tabular-nums">
          {currentIdx >= 0 ? currentIdx + 1 : 1}/{videos.length}
        </span>
      </button>
    );
  }

  return (
    <div
      ref={containerRef}
      className="flex h-11 min-w-0 flex-1 items-center gap-1 rounded-[10px] border border-[var(--lp-line-8)] bg-[var(--lp-surface-2)] px-1.5"
    >
      <button
        type="button"
        onClick={() => onExpandedChange(false)}
        aria-label="영상 네비게이터 닫기"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--lp-dim)] transition-colors hover:text-[var(--lp-strong)]"
      >
        <X className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={() => scroll('left')}
        aria-label="이전 썸네일"
        className="flex h-7 w-5 shrink-0 items-center justify-center text-[var(--lp-dim)] transition-colors hover:text-[var(--lp-strong)]"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </button>
      <div
        ref={scrollRef}
        className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto scrollbar-none py-1"
      >
        {videos.map((v) => {
          const isActive = v.ytId === currentVideoId;
          return (
            <Tooltip key={v.id} delayDuration={150}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  data-active={isActive}
                  onClick={() => {
                    if (!isActive) navigate(`/learning/${mandalaId}/${v.ytId}`);
                  }}
                  className={cn(
                    'relative h-8 w-[57px] shrink-0 overflow-hidden rounded-[5px] bg-[var(--lp-surface)] transition-opacity',
                    isActive ? 'ring-2 ring-[var(--lp-accent)]' : 'opacity-60 hover:opacity-100'
                  )}
                >
                  {v.thumbnail ? (
                    <img src={v.thumbnail} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="h-full w-full bg-[var(--lp-surface)]" />
                  )}
                </button>
              </TooltipTrigger>
              {/* Large preview — big enough to actually identify prev/next videos */}
              <TooltipContent side="bottom" className="max-w-none p-1.5">
                <div className="w-[240px]">
                  {v.thumbnail && (
                    <img
                      src={v.thumbnail}
                      alt=""
                      className="h-[135px] w-[240px] rounded-[6px] object-cover"
                    />
                  )}
                  <p className="mt-1.5 line-clamp-2 px-0.5 pb-0.5 text-[12px] leading-[1.4]">
                    {v.title}
                  </p>
                </div>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => scroll('right')}
        aria-label="다음 썸네일"
        className="flex h-7 w-5 shrink-0 items-center justify-center text-[var(--lp-dim)] transition-colors hover:text-[var(--lp-strong)]"
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
