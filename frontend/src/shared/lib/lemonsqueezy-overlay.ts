/**
 * Lemon Squeezy Lemon.js overlay helpers (CP456).
 *
 * Lemon.js exposes a global `window.LemonSqueezy` (loaded via `<script src=".../lemon.js" defer>`
 * in `index.html`). It draws an iframe overlay on the current page so the user never leaves
 * insighta.one for the checkout flow.
 *
 * API surface we rely on:
 *   window.LemonSqueezy.Setup({ eventHandler: (event) => ... })
 *   window.LemonSqueezy.Url.Open(url)        — open hosted checkout in overlay
 *   window.LemonSqueezy.Url.Close()          — programmatically close
 *
 * Event payload (what we care about):
 *   { event: 'Checkout.Success', data: { ... } }
 *   { event: 'PaymentMethodUpdate.Mounted' | 'PaymentMethodUpdate.Closed', ... }
 *
 * If Lemon.js is not yet loaded (network slow, ad-block, etc.), `openCheckout` falls back to
 * a full-page redirect so the user can still complete payment.
 */

export type LemonSqueezyEvent =
  | { event: 'Checkout.Success'; data?: unknown }
  | { event: string; data?: unknown };

export interface LemonSqueezyWindow {
  LemonSqueezy?: {
    Setup: (opts: { eventHandler: (event: LemonSqueezyEvent) => void }) => void;
    Url: {
      Open: (url: string) => void;
      Close: () => void;
    };
  };
}

function getLS(): LemonSqueezyWindow['LemonSqueezy'] | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as LemonSqueezyWindow).LemonSqueezy;
}

/**
 * Register a global event handler. Idempotent — calling multiple times replaces
 * the previous handler (Lemon.js semantics). Safe to call from React mount.
 *
 * Returns a cleanup function that resets the handler to a no-op.
 */
export function setupOverlay(onEvent: (event: LemonSqueezyEvent) => void): () => void {
  const ls = getLS();
  if (!ls) {
    // Lemon.js still loading. Retry once after the next macrotask — typical defer
    // load lands within ~100ms on warm cache.
    let cancelled = false;
    setTimeout(() => {
      if (cancelled) return;
      const lsLate = getLS();
      if (lsLate) lsLate.Setup({ eventHandler: onEvent });
    }, 250);
    return () => {
      cancelled = true;
    };
  }
  ls.Setup({ eventHandler: onEvent });
  return () => {
    // Reset to no-op handler on unmount.
    const lsCleanup = getLS();
    if (lsCleanup) lsCleanup.Setup({ eventHandler: () => {} });
  };
}

/**
 * Open the LS hosted checkout overlay for the given URL. If Lemon.js failed to
 * load, fall back to a full-page redirect so the user is never stuck.
 *
 * Note on backdrop theme: LS-returned URL has a `?signature=...` and is
 * signature-validated server-side, so we cannot mutate the URL to add a
 * `?dark=1` query (LS rejects with "Invalid signature"). Backdrop dark mode
 * is instead handled via CSS override targeting `.lemonsqueezy-loader` (see
 * `frontend/src/app/styles/index.css`).
 *
 * Close affordance: Lemon.js's iframe is `position: fixed; width: 100%; height: 100%`
 * and the LS-hosted page may not expose a visible X. We inject our own floating
 * close button + ESC key handler so the user always has an escape route.
 */
const CLOSE_BUTTON_ID = '__ls_close_button';
let escKeyHandler: ((e: KeyboardEvent) => void) | null = null;

function injectCloseUI(): void {
  if (typeof document === 'undefined') return;
  // Remove any stale instance first (idempotent).
  removeCloseUI();

  const btn = document.createElement('button');
  btn.id = CLOSE_BUTTON_ID;
  btn.setAttribute('aria-label', 'Close checkout');
  btn.setAttribute('type', 'button');
  // Inline styles — iframe is z-index 2147483647 (max int32); we sit one above.
  btn.setAttribute(
    'style',
    [
      'position: fixed',
      'top: 16px',
      'right: 16px',
      'z-index: 2147483647',
      'width: 36px',
      'height: 36px',
      'border-radius: 18px',
      'border: 0',
      'background: rgba(0, 0, 0, 0.6)',
      'color: white',
      'font-size: 20px',
      'line-height: 1',
      'cursor: pointer',
      'display: flex',
      'align-items: center',
      'justify-content: center',
      'padding: 0',
      'box-shadow: 0 2px 8px rgba(0,0,0,0.3)',
    ].join('; ')
  );
  btn.textContent = '×';
  btn.addEventListener('click', () => closeCheckout());
  document.body.appendChild(btn);

  escKeyHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') closeCheckout();
  };
  document.addEventListener('keydown', escKeyHandler);
}

function removeCloseUI(): void {
  if (typeof document === 'undefined') return;
  const existing = document.getElementById(CLOSE_BUTTON_ID);
  if (existing) existing.remove();
  if (escKeyHandler) {
    document.removeEventListener('keydown', escKeyHandler);
    escKeyHandler = null;
  }
}

export function openCheckout(checkoutUrl: string): void {
  const ls = getLS();
  if (ls) {
    ls.Url.Open(checkoutUrl);
    // Inject close UI on next tick so Lemon.js has time to mount the iframe.
    setTimeout(injectCloseUI, 50);
    return;
  }
  // Fallback — Lemon.js unavailable.
  if (typeof window !== 'undefined') {
    window.location.href = checkoutUrl;
  }
}

/**
 * Close the LS overlay programmatically.
 *
 * Note on the loader: Lemon.js's `Url.Close()` only removes the iframe — it
 * leaves any visible `.lemonsqueezy-loader` (backdrop + pulse spinner) in
 * place, because the loader is normally removed by a `mounted` postMessage
 * from the iframe. If the user closes before the iframe finishes mounting,
 * the loader is orphaned and the page appears stuck. We strip it manually.
 */
export function closeCheckout(): void {
  removeCloseUI();
  const ls = getLS();
  if (ls) ls.Url.Close();
  if (typeof document !== 'undefined') {
    document.querySelectorAll('.lemonsqueezy-loader').forEach((el) => el.remove());
    document.body.classList.remove('lemonsqueezy-loading');
    document.body.classList.remove('lemonsqueezy-open');
  }
}
