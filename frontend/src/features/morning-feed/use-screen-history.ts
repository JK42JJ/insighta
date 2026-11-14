import { useCallback, useEffect, useRef, useState } from 'react';

/*
 * Screens in the browser history (scenario test 2026-11-14: the browser's back left the watch
 * screen from any screen). Moving to another screen pushes an entry; an update of the same screen
 * (isSame) or an explicit replace keeps the entry. Back and forward restore the screen kept for
 * that entry. Other code may push its own entries on top (the page's video layer); an entry that
 * names the current screen changes nothing here.
 */
export function useScreenHistory<T>(
  initial: () => T,
  isSame: (a: T, b: T) => boolean
): [T, (next: T, opts?: { replace?: boolean }) => void] {
  const [screen, setState] = useState<T>(initial);
  const nav = useRef<{ stack: T[]; idx: number }>({ stack: [screen], idx: 0 });
  const current = useRef(screen);
  current.current = screen;
  const sameRef = useRef(isSame);
  sameRef.current = isSame;

  const go = useCallback((next: T, opts: { replace?: boolean } = {}) => {
    const n = nav.current;
    if (opts.replace || sameRef.current(current.current, next)) {
      n.stack[n.idx] = next;
      window.history.replaceState({ ...(window.history.state ?? {}), mfScreen: n.idx }, '');
    } else {
      n.stack = n.stack.slice(0, n.idx + 1);
      n.stack.push(next);
      n.idx = n.stack.length - 1;
      window.history.pushState({ mfScreen: n.idx }, '');
    }
    current.current = next;
    setState(next);
  }, []);

  useEffect(() => {
    window.history.replaceState({ ...(window.history.state ?? {}), mfScreen: nav.current.idx }, '');
    const onPop = (e: PopStateEvent): void => {
      const i = (e.state as { mfScreen?: unknown } | null)?.mfScreen;
      const n = nav.current;
      const target = typeof i === 'number' && n.stack[i] !== undefined ? i : 0;
      if (target === n.idx && n.stack[target] === current.current) return;
      n.idx = target;
      current.current = n.stack[target]!;
      setState(n.stack[target]!);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  return [screen, go];
}
