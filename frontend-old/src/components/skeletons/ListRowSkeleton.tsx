import { Skeleton } from '@/components/ui/skeleton';

export function ListRowSkeleton() {
  return (
    <div className="flex items-center gap-3 px-3 py-2 border-l-2 border-transparent">
      <Skeleton className="h-9 w-12 shrink-0 rounded" />
      <div className="min-w-0 flex-1">
        <Skeleton className="h-4 w-3/4" />
      </div>
      <Skeleton className="h-4 w-10 rounded-full" />
      <Skeleton className="h-3 w-8" />
    </div>
  );
}

export function ListRowSkeletonGroup({ count = 8 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <ListRowSkeleton key={i} />
      ))}
    </>
  );
}
