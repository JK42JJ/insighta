import { Skeleton } from '@/components/ui/skeleton';

export function DetailPanelSkeleton() {
  return (
    <div className="p-4 space-y-4">
      <Skeleton className="aspect-video w-full rounded-xl" />
      <div className="space-y-2">
        <Skeleton className="h-5 w-4/5" />
        <Skeleton className="h-4 w-1/2" />
      </div>
      <div className="space-y-2 pt-2">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-24 w-full rounded-lg" />
      </div>
      <div className="flex gap-2 pt-2">
        <Skeleton className="h-9 w-9 rounded-lg" />
        <Skeleton className="h-9 w-9 rounded-lg" />
        <Skeleton className="h-9 flex-1 rounded-lg" />
      </div>
    </div>
  );
}
