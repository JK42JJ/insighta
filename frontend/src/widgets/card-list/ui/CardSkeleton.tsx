import { cn } from '@/shared/lib/utils';

/**
 * CP499+ — single skeleton cell, grid-agnostic. CardList renders these INSIDE
 * its own grid (next cell after the last visible card) so the loading tail
 * sits flush under the cards instead of below the grid's stretched minHeight
 * (the "big gap before skeletons" defect, prod 2026-06-10) — and inherits the
 * user's gridColumns instead of this file's own breakpoint columns.
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

/** Standalone block variant — used when there are no cards to align with
 *  (initial isLoading full-replace). Brings its own responsive grid. */
export function CardSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 p-3">
      {Array.from({ length: count }).map((_, i) => (
        <CardSkeletonCell key={i} index={i} />
      ))}
    </div>
  );
}
