/**
 * pageScroll — scroll a lane horizontally by one full visible page.
 *
 * James 2026-07-02: chevron paging must move a WHOLE page ("찔끔" 금지),
 * used by the sector filter bar and card tag rows alike.
 *
 * Implemented as an rAF-animated scrollLeft write because the options-form
 * `scrollBy/scrollTo({behavior:'smooth'})` is silently no-op'd in our
 * runtime (measured 2026-07-02 — session-replay API patching intercepts
 * the options form; direct property assignment is unaffected).
 */
const PAGE_SCROLL_DURATION_MS = 240;

export function pageScroll(el: HTMLElement | null, dir: 1 | -1): void {
  if (!el) return;
  const max = el.scrollWidth - el.clientWidth;
  const from = el.scrollLeft;
  const target = Math.max(0, Math.min(max, from + dir * el.clientWidth));
  if (target === from) return;
  const start = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / PAGE_SCROLL_DURATION_MS);
    const eased = 1 - (1 - t) * (1 - t); // ease-out quad
    el.scrollLeft = from + (target - from) * eased;
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
