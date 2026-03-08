import { Skeleton } from '@/components/ui/skeleton';

export function CardSkeleton() {
  return (
    <div className="rounded-2xl overflow-hidden border border-border/40 bg-card">
      <Skeleton className="aspect-video w-full" />
      <div className="p-3 space-y-2">
        <div className="flex items-start gap-2">
          <Skeleton className="h-6 w-6 rounded-lg shrink-0" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </div>
        <div className="flex items-center justify-between pt-2 border-t border-border/30">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-6 w-6 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

export function CardSkeletonGrid({ count = 6 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <CardSkeleton key={i} />
      ))}
    </>
  );
}
