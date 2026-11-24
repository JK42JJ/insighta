import { useCallback, useEffect, useRef, useState } from 'react';

/*
 * Screens in the browser history (scenario test 2026-11-14: the browser's back left the watch
 * screen from any screen). Moving to another screen pushes an entry; an update of the same screen
 * (isSame) or an explicit replace keeps the entry. Back and forward restore the screen kept for
 * that entry. Other code may push its own entries on top (the page's video layer); an entry that
 * names the current screen changes nothing here.
 *
 * The whole stack is returned as well (decision 2026-11-14 "앱처럼 반응"): screens under the top
 * can stay mounted, so going back neither reads them again nor loses their scroll position, and
 * the last move says which way to slide. A back that the browser already animates itself
 * (Safari's edge swipe) is marked `native`, and the screens then change without our slide.
 */

export interface ScreenEntry<T> {
  /** Stable while the entry shows the same screen; a new id = a new screen in that place. */
  id: number;
  screen: T;
}

export interface ScreenMove {
  dir: 'push' | 'pop' | 'replace' | 'none';
  /** The browser draws its own transition for this move (do not slide again). */
  native: boolean;
  /** Changes with every move. */
  seq: number;
}

export interface ScreenStackView<T> {
  /** Entries up to and including the shown one. */
  entries: ReadonlyArray<ScreenEntry<T>>;
  move: ScreenMove;
}

/** A touch this close to a side edge may be Safari's own back/forward swipe. */
const EDGE_PX = 24;
/** A history move this soon after such a touch counts as the browser's swipe. */
const EDGE_SWIPE_WINDOW_MS = 1500;

/** True when the browser said it animated this history move itself, or an edge swipe started it. */
export function isNativeBack(e: PopStateEvent, lastEdgeTouchAt: number, now: number): boolean {
  const ua = (e as PopStateEvent & { hasUAVisualTransition?: boolean }).hasUAVisualTransition;
  if (ua === true) return true;
  return lastEdgeTouchAt > 0 && now - lastEdgeTouchAt <= EDGE_SWIPE_WINDOW_MS;
}

/*
 * Safari's edge swipe: the page sees the touch start at the edge and then a cancel (the browser
 * took it). A touch that ends normally (a tap on the back button near the edge) is not a swipe,
 * so our own slide still plays for it. One tracker for every history listener on the page.
 */
let edgeTouchAt = 0;
let trackers = 0;
const onEdgeTouch = (e: TouchEvent): void => {
  const x = e.touches[0]?.clientX;
  if (x === undefined) return;
  edgeTouchAt = x <= EDGE_PX || x >= window.innerWidth - EDGE_PX ? Date.now() : 0;
};
const onEdgeTouchEnd = (): void => {
  edgeTouchAt = 0;
};
/** Starts the edge-swipe tracker (counted, so several users share one); returns the stop. */
export function trackEdgeSwipe(): () => void {
  if (trackers++ === 0) {
    window.addEventListener('touchstart', onEdgeTouch, { passive: true, capture: true });
    window.addEventListener('touchend', onEdgeTouchEnd, { passive: true, capture: true });
  }
  return () => {
    if (--trackers === 0) {
      window.removeEventListener('touchstart', onEdgeTouch, { capture: true });
      window.removeEventListener('touchend', onEdgeTouchEnd, { capture: true });
    }
  };
}
/** This history move was drawn by the browser itself (do not slide again). */
export function popIsNative(e: PopStateEvent): boolean {
  const native = isNativeBack(e, edgeTouchAt, Date.now());
  edgeTouchAt = 0;
  return native;
}

export function useScreenHistory<T>(
  initial: () => T,
  isSame: (a: T, b: T) => boolean
): [T, (next: T, opts?: { replace?: boolean }) => void, ScreenStackView<T>] {
  const seq = useRef(1);
  const [view, setView] = useState<{
    stack: Array<ScreenEntry<T>>;
    idx: number;
    move: ScreenMove;
  }>(() => ({
    stack: [{ id: seq.current++, screen: initial() }],
    idx: 0,
    move: { dir: 'none', native: false, seq: 0 },
  }));
  const nav = useRef(view);
  nav.current = view;
  const sameRef = useRef(isSame);
  sameRef.current = isSame;

  const go = useCallback((next: T, opts: { replace?: boolean } = {}) => {
    const n = nav.current;
    const cur = n.stack[n.idx]!;
    let out: typeof n;
    if (sameRef.current(cur.screen, next)) {
      const stack = n.stack.slice();
      stack[n.idx] = { id: cur.id, screen: next };
      out = { stack, idx: n.idx, move: n.move };
      window.history.replaceState({ ...(window.history.state ?? {}), mfScreen: n.idx }, '');
    } else if (opts.replace) {
      const stack = n.stack.slice();
      stack[n.idx] = { id: seq.current++, screen: next };
      out = { stack, idx: n.idx, move: { dir: 'replace', native: false, seq: n.move.seq + 1 } };
      window.history.replaceState({ ...(window.history.state ?? {}), mfScreen: n.idx }, '');
    } else {
      const stack = n.stack.slice(0, n.idx + 1);
      stack.push({ id: seq.current++, screen: next });
      out = {
        stack,
        idx: stack.length - 1,
        move: { dir: 'push', native: false, seq: n.move.seq + 1 },
      };
      window.history.pushState({ mfScreen: out.idx }, '');
    }
    nav.current = out;
    setView(out);
  }, []);

  useEffect(() => {
    window.history.replaceState({ ...(window.history.state ?? {}), mfScreen: nav.current.idx }, '');
    const onPop = (e: PopStateEvent): void => {
      const i = (e.state as { mfScreen?: unknown } | null)?.mfScreen;
      const n = nav.current;
      const target = typeof i === 'number' && n.stack[i] !== undefined ? i : 0;
      if (target === n.idx) return;
      const out = {
        stack: n.stack,
        idx: target,
        move: {
          dir: target < n.idx ? ('pop' as const) : ('push' as const),
          native: popIsNative(e),
          seq: n.move.seq + 1,
        },
      };
      nav.current = out;
      setView(out);
    };
    const stopEdge = trackEdgeSwipe();
    window.addEventListener('popstate', onPop);
    return () => {
      stopEdge();
      window.removeEventListener('popstate', onPop);
    };
  }, []);

  return [
    view.stack[view.idx]!.screen,
    go,
    { entries: view.stack.slice(0, view.idx + 1), move: view.move },
  ];
}
