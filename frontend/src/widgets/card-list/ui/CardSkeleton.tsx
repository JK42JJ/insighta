export function CardSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 p-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-2xl overflow-hidden relative">
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
              animation: `shimmer 1.5s ease-in-out infinite ${i * 100}ms`,
            }}
          />
        </div>
      ))}
    </div>
  );
}
