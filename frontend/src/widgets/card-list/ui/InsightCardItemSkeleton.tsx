/** Single-tile skeleton that mirrors InsightCardItemV2's layout.
 *  Used inside CardList for per-card batch reveal so the skeleton
 *  occupies exactly the same grid cell as the real card. */
export function InsightCardItemSkeleton() {
  return (
    <div className="w-full overflow-hidden rounded-2xl relative">
      {/* Thumbnail placeholder — matches InsightCardItemV2's aspect-video
          dark-gradient container so reveal swaps in-place without size
          jitter. */}
      <div className="relative aspect-video overflow-hidden rounded-[10px] bg-gradient-to-br from-[#1a1c28] to-[#13141c]" />

      {/* Body placeholder — px-3 pt-2 pb-4 matches the real card. Two
          bars approximate the title (line-clamp-2 → ~34px) and the
          meta row. */}
      <div className="px-3 pt-2 pb-4 space-y-2">
        <div className="h-[34px] bg-muted/40 rounded" />
        <div className="h-[14px] bg-muted/30 rounded w-2/3" />
      </div>

      {/* Subtle shimmer sweep — opaque enough to read as "loading", but
          dim so it doesn't compete with the eventual real card. */}
      <div
        className="absolute inset-0 -translate-x-full pointer-events-none"
        style={{
          background:
            'linear-gradient(90deg, transparent, hsl(var(--foreground) / 0.04), transparent)',
          animation: 'shimmer 1.5s ease-in-out infinite',
        }}
      />
    </div>
  );
}
