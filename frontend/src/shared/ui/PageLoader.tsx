/**
 * PageLoader — Suspense fallback shown while lazy page chunks load.
 *
 * Visually mirrors the static boot-shell in `frontend/index.html` so users see
 * one continuous loader from HTML parse → React mount → page chunk ready,
 * rather than a brand-then-spinner two-step. Markup intentionally duplicates
 * the inline style block (same brand text + pulse bar) and reuses the global
 * `boot-shell-pulse` keyframes defined in index.html.
 */
export function PageLoader() {
  return (
    <div
      role="presentation"
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[9999] flex flex-col items-center justify-center gap-5 bg-white dark:bg-[hsl(220,16%,8%)]"
    >
      <div
        className="text-[28px] font-semibold tracking-[-0.02em] text-[hsl(220,16%,20%)] dark:text-[hsl(0,0%,88%)]"
        style={{
          fontFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
        }}
      >
        Insighta
      </div>
      <div
        className="h-[3px] w-12 rounded-[2px] bg-[hsl(220,8%,70%)] dark:bg-[hsl(0,0%,35%)]"
        style={{ animation: 'boot-shell-pulse 1.4s ease-in-out infinite' }}
      />
      <style>{`
        @keyframes boot-shell-pulse {
          0%, 100% { opacity: 0.25; transform: scaleX(0.4); }
          50%      { opacity: 1;    transform: scaleX(1); }
        }
      `}</style>
    </div>
  );
}
