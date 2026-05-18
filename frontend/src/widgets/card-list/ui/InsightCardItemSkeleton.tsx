/** Single-tile skeleton — exact layout parity with CardSkeleton's per-tile
 *  markup (CardSkeleton.tsx:5-19). Used inside CardList's CardSlot so the
 *  phase-1 fallback (cards=0 → <CardSkeleton count=6 />) and the phase-2
 *  per-card overlay share identical visuals; the user sees one consistent
 *  skeleton style across the mandala-switch timeline. */
export function InsightCardItemSkeleton() {
  return (
    <div className="rounded-2xl overflow-hidden relative w-full">
      <div className="aspect-video bg-muted" />
      <div className="p-3 space-y-2">
        <div className="h-4 bg-muted rounded w-3/4" />
        <div className="h-3 bg-muted rounded w-1/2" />
      </div>
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
