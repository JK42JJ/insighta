import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';

import { MOTION, prefersReducedMotion } from '@/features/morning-feed/motion-tokens';

/*
 * A sheet rising from the bottom (decision 2026-11-14 "앱처럼 반응"): it comes up and the screen
 * behind darkens; dragging it down follows the finger, and it closes when dragged far enough or
 * flicked down, or when the dark area is tapped. Reduced motion: opacity only.
 */

/** After the slide's own length, the sheet is closed even if the animation never reported. */
const CLOSE_GRACE_MS = 120;

interface Props {
  onClose: () => void;
  /** A function gets the sheet's own close (slides down first) for buttons inside. */
  children: ReactNode | ((close: () => void) => ReactNode);
  className?: string;
  testId?: string;
  label?: string;
}

export function BottomSheet({ onClose, children, className, testId, label }: Props): JSX.Element {
  const sheet = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const closing = useRef(false);
  const drag = useRef<{
    id: number;
    y0: number;
    t0: number;
    dy: number;
    lastT: number;
    lastY: number;
  } | null>(null);
  const { ms, ease, scrim: dark, closeDistance, closeVelocity } = MOTION.sheet;

  useLayoutEffect(() => {
    const s = sheet.current;
    const c = scrim.current;
    if (!s || !c) return;
    const o = { duration: ms, easing: ease, fill: 'both' as const };
    if (prefersReducedMotion()) {
      s.animate?.([{ opacity: 0 }, { opacity: 1 }], o);
    } else {
      s.animate?.([{ transform: 'translate3d(0,100%,0)' }, { transform: 'translate3d(0,0,0)' }], o);
    }
    c.animate?.([{ opacity: 0 }, { opacity: dark }], o);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = (): void => {
    if (closing.current) return;
    closing.current = true;
    const s = sheet.current;
    const c = scrim.current;
    if (!s || !c || typeof s.animate !== 'function') {
      onClose();
      return;
    }
    const from = drag.current?.dy ?? 0;
    const o = { duration: ms, easing: ease, fill: 'forwards' as const };
    const a = prefersReducedMotion()
      ? s.animate([{ opacity: 1 }, { opacity: 0 }], o)
      : s.animate(
          [{ transform: `translate3d(0,${from}px,0)` }, { transform: 'translate3d(0,100%,0)' }],
          o
        );
    c.animate([{ opacity: Number(getComputedStyle(c).opacity) || dark }, { opacity: 0 }], o);
    // closes when the slide ends, and at the latest a moment after it should have
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      onClose();
    };
    void a.finished.then(finish, finish);
    window.setTimeout(finish, ms + CLOSE_GRACE_MS);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setY = (dy: number): void => {
    const s = sheet.current;
    const c = scrim.current;
    if (!s || !c) return;
    s.getAnimations?.().forEach((a) => a.cancel());
    c.getAnimations?.().forEach((a) => a.cancel());
    s.style.transform = `translate3d(0,${dy}px,0)`;
    const h = s.offsetHeight || 1;
    c.style.opacity = String(dark * Math.max(0, 1 - dy / h));
  };

  return (
    <>
      <div
        ref={scrim}
        className="mf-sheet-scrim"
        data-testid="mf-sheet-scrim"
        style={{ opacity: dark }}
        onClick={close}
      />
      <div
        ref={sheet}
        className={'mf-sheet ' + (className ?? '')}
        data-testid={testId}
        role="dialog"
        aria-label={label}
        onPointerDown={(e) => {
          if ((e.target as Element).closest('[data-press]')) return;
          drag.current = {
            id: e.pointerId,
            y0: e.clientY,
            t0: e.timeStamp,
            dy: 0,
            lastT: e.timeStamp,
            lastY: e.clientY,
          };
          (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || d.id !== e.pointerId || closing.current) return;
          d.dy = Math.max(0, e.clientY - d.y0);
          d.lastT = e.timeStamp;
          d.lastY = e.clientY;
          setY(d.dy);
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          if (!d || d.id !== e.pointerId) return;
          const dt = Math.max(1, e.timeStamp - d.t0);
          const v = d.dy / dt;
          if (d.dy >= closeDistance || (v >= closeVelocity && d.dy > 10)) {
            close();
          } else {
            const s = sheet.current;
            const c = scrim.current;
            const o = { duration: ms, easing: ease };
            s?.animate?.(
              [{ transform: `translate3d(0,${d.dy}px,0)` }, { transform: 'translate3d(0,0,0)' }],
              o
            );
            c?.animate?.([{ opacity: c.style.opacity || dark }, { opacity: dark }], o);
            if (s) s.style.transform = '';
            if (c) c.style.opacity = String(dark);
          }
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
          setY(0);
          if (sheet.current) sheet.current.style.transform = '';
        }}
      >
        {typeof children === 'function' ? children(close) : children}
      </div>
    </>
  );
}
