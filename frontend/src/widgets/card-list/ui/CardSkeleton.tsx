import { cn } from '@/shared/lib/utils';

/**
 * CP499+ — single skeleton cell, grid-agnostic BY DESIGN: this file owns NO
 * grid. Every render site (CardList initial-load skeleton AND the lazy-
 * pagination tail) places these cells inside CardList's own card grid
 * (shared CARD_GRID_CLASS / cardGridStyle), so skeletons always match the
 * user's gridColumns. The old standalone <CardSkeleton> block with its own
 * breakpoint grid (md:2/lg:3/xl:4) was the 4-col-skeleton vs 3-col-cards
 * defect — do not reintroduce a grid wrapper here.
 */
export function CardSkeletonCell({ index = 0, className }: { index?: number; className?: string }) {
  return (
    <div className={cn('rounded-2xl overflow-hidden relative', className)}>
      <div className="aspect-video bg-muted" />
      <div className="p-3 space-y-2">
        <div className="h-4 bg-muted rounded w-3/4" />
        <div className="h-3 bg-muted rounded w-1/2" />
      </div>
      {/* Shimmer sweep overlay */}
      <div
        className="absolute inset-0 -translate-x-full"
        style={{
          background:
            'linear-gradient(90deg, transparent, hsl(var(--foreground) / 0.04), transparent)',
          animation: `shimmer 1.5s ease-in-out infinite ${index * 100}ms`,
        }}
      />
    </div>
  );
}
