import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
  type RefObject,
  type WheelEvent,
} from 'react';
import { flushSync } from 'react-dom';

import { FIRST_SCENE, nextScene, type Scene } from '../model/landing-scene';
import {
  addSample,
  DRAG_SLOP_PX,
  dragOffset,
  judgeSwipe,
  releaseSpeed,
  SETTLE_EASE,
  SETTLE_MS,
  swipeValue,
  WHEEL_BURST_GAP_MS,
  WHEEL_GROUP_MS,
  WHEEL_MIN,
  type Dir,
  type Sample,
} from '../model/landing-swipe';

/** One scene page. The id stays with the page while it moves from neighbour to current and back. */
export interface Pane {
  id: number;
  s: Scene;
}
export interface Panes {
  prev: Pane | null;
  cur: Pane;
  next: Pane | null;
}

interface Drag {
  pointer: number;
  x0: number;
  y0: number;
  /** Screen height when the finger came down: never read again during the gesture. */
  height: number;
  samples: Sample[];
  active: boolean;
}

interface Options {
  /** Design px -> screen px of the stage. */
  scale: number;
  reduced: boolean;
  /** The current scene changed (a page settled or a tap moved it). */
  onScene: (s: Scene) => void;
  onGesture: (value: string) => void;
}

export interface ScenePager {
  panes: Panes;
  trackRef: RefObject<HTMLDivElement>;
  /** Pages to a neighbour (wheel, keys). */
  step: (d: Dir) => void;
  /** Changes the scene in place, with the design's own motion (source tap, dots). */
  go: (s: Scene) => void;
  /** A finger is on the page or a page is settling. */
  busy: () => boolean;
  /** When the last drag ended (ms): the click it produces is not a tap. */
  draggedAt: RefObject<number>;
  handlers: {
    onPointerDown: (e: PointerEvent<HTMLElement>) => void;
    onPointerMove: (e: PointerEvent<HTMLElement>) => void;
    onPointerUp: (e: PointerEvent<HTMLElement>) => void;
    onPointerCancel: (e: PointerEvent<HTMLElement>) => void;
    onLostPointerCapture: (e: PointerEvent<HTMLElement>) => void;
    onWheel: (e: WheelEvent<HTMLElement>) => void;
  };
}

/** Vertical paging of the landing scenes: the finger moves the page 1:1 (rules: landing-swipe.ts). */
export function useScenePager({ scale, reduced, onScene, onGesture }: Options): ScenePager {
  const ids = useRef(0);
  const pane = useCallback(
    (s: Scene | null): Pane | null => (s === null ? null : { id: ++ids.current, s }),
    []
  );
  const around = useCallback(
    (cur: Pane): Panes => ({
      prev: pane(nextScene(cur.s, -1)),
      cur,
      next: pane(nextScene(cur.s, 1)),
    }),
    [pane]
  );
  const [panes, setPanes] = useState<Panes>(() => around({ id: 0, s: FIRST_SCENE }));
  const panesRef = useRef(panes);
  panesRef.current = panes;

  const trackRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const settle = useRef<{ timer: number; dir: Dir | null } | null>(null);
  const draggedAt = useRef(-Infinity);
  const wheelLast = useRef(-Infinity);
  const wheelStep = useRef(-Infinity);
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const cb = useRef({ onScene, onGesture });
  cb.current = { onScene, onGesture };

  const move = (y: string, animate: boolean): void => {
    const el = trackRef.current;
    if (!el) return;
    el.style.transition = animate ? `transform ${SETTLE_MS}ms ${SETTLE_EASE}` : 'none';
    el.style.transform = y === '0' ? 'none' : `translate3d(0, ${y}, 0)`;
  };
  // the pages changed places: the track is back at 0 in the same frame
  useLayoutEffect(() => move('0', false), [panes.cur.id]);

  const commit = useCallback(
    (dir: Dir | null): void => {
      const p = panesRef.current;
      const to = dir === 1 ? p.next : dir === -1 ? p.prev : null;
      if (!to) {
        move('0', false);
        return;
      }
      const q: Panes =
        dir === 1
          ? { prev: p.cur, cur: to, next: pane(nextScene(to.s, 1)) }
          : { prev: pane(nextScene(to.s, -1)), cur: to, next: p.cur };
      panesRef.current = q;
      flushSync(() => {
        setPanes(q);
        cb.current.onScene(to.s);
      });
    },
    [pane]
  );

  /** A settling page goes to its end at once, so the next gesture starts from there. */
  const finish = useCallback((): void => {
    const st = settle.current;
    if (!st) return;
    settle.current = null;
    window.clearTimeout(st.timer);
    commit(st.dir);
  }, [commit]);

  const settleTo = useCallback(
    (dir: Dir | null): void => {
      if (reduced) {
        commit(dir);
        return;
      }
      move(dir === null ? '0' : dir === 1 ? '-100%' : '100%', true);
      const timer = window.setTimeout(() => {
        settle.current = null;
        commit(dir);
      }, SETTLE_MS);
      settle.current = { timer, dir };
    },
    [commit, reduced]
  );

  useEffect(
    () => () => {
      if (settle.current) window.clearTimeout(settle.current.timer);
      settle.current = null;
    },
    []
  );

  const step = useCallback(
    (d: Dir): void => {
      finish();
      if (drag.current) return;
      const p = panesRef.current;
      if (d === 1 ? p.next : p.prev) settleTo(d);
    },
    [finish, settleTo]
  );

  const go = useCallback(
    (s: Scene): void => {
      finish();
      const p = panesRef.current;
      if (p.cur.s === s) return;
      const q = around({ id: p.cur.id, s });
      panesRef.current = q;
      setPanes(q);
      cb.current.onScene(s);
    },
    [around, finish]
  );

  const offsetOf = (d: Drag, y: number): number => {
    const p = panesRef.current;
    const dy = y - d.y0;
    const free = Math.sign(dy) * Math.max(0, Math.abs(dy) - DRAG_SLOP_PX);
    return dragOffset(free, d.height, !!p.prev, !!p.next) / scaleRef.current;
  };

  const inStage = (e: { currentTarget: EventTarget; target: EventTarget }): boolean =>
    (e.currentTarget as Node).contains(e.target as Node);

  const onPointerDown = (e: PointerEvent<HTMLElement>): void => {
    if (!inStage(e) || drag.current || (e.pointerType === 'mouse' && e.button !== 0)) return;
    finish();
    drag.current = {
      pointer: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      height: window.innerHeight,
      samples: [{ t: e.timeStamp, y: e.clientY }],
      active: false,
    };
  };
  const onPointerMove = (e: PointerEvent<HTMLElement>): void => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointer) return;
    d.samples = addSample(d.samples, { t: e.timeStamp, y: e.clientY });
    if (!d.active) {
      if (Math.abs(e.clientY - d.y0) < DRAG_SLOP_PX) return;
      d.active = true;
      // captured only once it is a drag: captured at the press, taps would never reach the buttons
      try {
        e.currentTarget.setPointerCapture?.(e.pointerId);
      } catch {
        /* the pointer is already gone: its up or cancel ends the drag */
      }
    }
    move(`${offsetOf(d, e.clientY)}px`, false);
  };
  /** Up and cancel end a gesture the same way: by the distance and speed it had. */
  const end = (e: PointerEvent<HTMLElement>, y: number | null): void => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointer) return;
    drag.current = null;
    if (y !== null && y !== d.samples[d.samples.length - 1]!.y) {
      d.samples = addSample(d.samples, { t: e.timeStamp, y });
    }
    const last = d.samples[d.samples.length - 1]!;
    const dy = last.y - d.y0;
    if (!d.active && Math.abs(dy) < DRAG_SLOP_PX) return; // a tap
    draggedAt.current = Date.now();
    const speed = releaseSpeed(d.samples, e.timeStamp);
    const p = panesRef.current;
    const dir = judgeSwipe(dy, speed, d.height);
    const to = dir === 1 ? p.next : dir === -1 ? p.prev : null;
    cb.current.onGesture(swipeValue(dy, speed, d.height, to !== null));
    settleTo(to ? dir : null);
  };
  const onPointerUp = (e: PointerEvent<HTMLElement>): void => end(e, e.clientY);
  // a cancel carries no position of its own: what the finger did until then counts
  const onPointerCancel = (e: PointerEvent<HTMLElement>): void => end(e, null);
  // a touch is captured by the element it began on; taking it over makes THAT element lose it (the
  // event bubbles here). Only the stage losing its own capture is an end.
  const onLostPointerCapture = (e: PointerEvent<HTMLElement>): void => {
    if (e.target === e.currentTarget) end(e, null);
  };

  const onWheel = (e: WheelEvent<HTMLElement>): void => {
    if (!inStage(e) || Math.abs(e.deltaY) <= WHEEL_MIN) return;
    const now = Date.now();
    const same = now - wheelLast.current < WHEEL_BURST_GAP_MS;
    wheelLast.current = now;
    if (same || now - wheelStep.current < WHEEL_GROUP_MS) return;
    wheelStep.current = now;
    step(e.deltaY > 0 ? 1 : -1);
  };

  const busy = useCallback((): boolean => !!drag.current || !!settle.current, []);
  return {
    panes,
    trackRef,
    step,
    go,
    busy,
    draggedAt,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onLostPointerCapture,
      onWheel,
    },
  };
}
