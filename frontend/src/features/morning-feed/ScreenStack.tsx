import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

import type { ScreenMove } from '@/features/morning-feed/use-screen-history';
import { MOTION, prefersReducedMotion } from '@/features/morning-feed/motion-tokens';

/*
 * One level in or out (decision 2026-11-14 "앱처럼 반응"): the new screen slides in from the
 * right while the one underneath moves 30 % to the left and darkens a little; going back is
 * exactly the reverse. Screens under the top stay mounted (hidden), so they are not read again
 * and keep their scroll position. A move the browser animates itself (Safari's edge swipe) and
 * a replace change at once. Reduced motion: opacity only.
 */

export interface StackLayer {
  id: number;
  node: ReactNode;
}

interface Props {
  /** Bottom to top; the last one is shown. Layers not kept by the caller are simply absent. */
  layers: StackLayer[];
  move: ScreenMove;
}

export function ScreenStack({ layers, move }: Props): JSX.Element {
  const top = layers[layers.length - 1]!;
  const els = useRef(new Map<number, HTMLDivElement>());
  const dims = useRef(new Map<number, HTMLDivElement>());
  const lastTop = useRef<StackLayer>(top);
  const lastSeq = useRef(move.seq);
  /** The screen that is sliding away after a back move (no longer in the stack). */
  const [leaving, setLeaving] = useState<StackLayer | null>(null);
  const [moving, setMoving] = useState<ReadonlySet<number>>(() => new Set());
  const anims = useRef<Animation[]>([]);

  useLayoutEffect(() => {
    if (move.seq === lastSeq.current) {
      lastTop.current = top;
      return;
    }
    lastSeq.current = move.seq;
    const prev = lastTop.current;
    lastTop.current = top;
    anims.current.forEach((a) => a.finish());
    anims.current = [];
    if (prev.id === top.id || move.native || move.dir === 'replace' || move.dir === 'none') {
      setLeaving(null);
      setMoving(new Set());
      return;
    }
    if (move.dir === 'push') {
      setLeaving(null);
      setMoving(new Set([prev.id, top.id]));
    } else {
      setLeaving(prev);
      setMoving(new Set([prev.id, top.id]));
    }
    // the layers are drawn with the moving marks first; the animation starts in the next effect
  }, [move.seq, move.dir, move.native, top]);

  useLayoutEffect(() => {
    if (moving.size === 0) return;
    const reduced = prefersReducedMotion();
    const { ms, ease, underShift, underDim } = MOTION.push;
    const o: KeyframeAnimationOptions = { duration: ms, easing: ease, fill: 'both' };
    const shift = `translate3d(${-underShift * 100}%,0,0)`;
    const run = (el: Element | undefined, kf: Keyframe[]): void => {
      if (el && typeof (el as HTMLElement).animate === 'function') {
        anims.current.push((el as HTMLElement).animate(kf, o));
      }
    };
    const ids = [...moving];
    if (leaving) {
      // back: the leaving screen goes out to the right, the one under comes back from the left
      const under = ids.find((i) => i !== leaving.id)!;
      if (reduced) {
        run(els.current.get(leaving.id), [{ opacity: 1 }, { opacity: 0 }]);
      } else {
        run(els.current.get(leaving.id), [
          { transform: 'translate3d(0,0,0)' },
          { transform: 'translate3d(100%,0,0)' },
        ]);
        run(els.current.get(under), [{ transform: shift }, { transform: 'translate3d(0,0,0)' }]);
        run(dims.current.get(under), [{ opacity: underDim }, { opacity: 0 }]);
      }
    } else {
      const under = ids[0]!;
      const incoming = ids[1]!;
      if (reduced) {
        run(els.current.get(incoming), [{ opacity: 0 }, { opacity: 1 }]);
      } else {
        run(els.current.get(incoming), [
          { transform: 'translate3d(100%,0,0)' },
          { transform: 'translate3d(0,0,0)' },
        ]);
        run(els.current.get(under), [{ transform: 'translate3d(0,0,0)' }, { transform: shift }]);
        run(dims.current.get(under), [{ opacity: 0 }, { opacity: underDim }]);
      }
    }
    const list = anims.current;
    let on = true;
    void Promise.all(list.map((a) => a.finished.catch(() => undefined))).then(() => {
      if (!on) return;
      list.forEach((a) => a.cancel());
      setLeaving(null);
      setMoving(new Set());
    });
    return () => {
      on = false;
    };
  }, [moving, leaving]);

  // On the render of a back move the leaving screen is kept in the tree right away (read from the
  // last render), so it is never unmounted and mounted again before it slides out.
  const pendingLeave =
    move.seq !== lastSeq.current &&
    move.dir === 'pop' &&
    !move.native &&
    lastTop.current.id !== top.id &&
    !layers.some((l) => l.id === lastTop.current.id)
      ? lastTop.current
      : null;
  const out = leaving ?? pendingLeave;
  const shown = out ? [...layers, out] : layers;
  const topId = out ? out.id : top.id;
  return (
    <div className="mf-stack" data-testid="mf-stack" data-moving={moving.size ? '' : undefined}>
      {shown.map((l) => {
        const isMoving = moving.has(l.id);
        const covered = l.id !== topId && !isMoving;
        return (
          <div
            key={l.id}
            ref={(el) => {
              if (el) els.current.set(l.id, el);
              else els.current.delete(l.id);
            }}
            className="mf-stack-layer"
            data-testid="mf-stack-layer"
            data-covered={covered ? '' : undefined}
            data-moving={isMoving ? '' : undefined}
            data-top={l.id === top.id ? '' : undefined}
            aria-hidden={l.id === top.id ? undefined : true}
            style={{ zIndex: shown.indexOf(l) + 1 }}
          >
            {l.node}
            <div
              className="mf-stack-dim"
              ref={(el) => {
                if (el) dims.current.set(l.id, el);
                else dims.current.delete(l.id);
              }}
            />
          </div>
        );
      })}
    </div>
  );
}
