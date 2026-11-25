import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
} from 'react';

import { MOTION, prefersReducedMotion } from '@/features/morning-feed/motion-tokens';
import {
  SourcePlayer,
  type SourcePlayerHandle,
  type SourceTarget,
} from '@/features/morning-feed/SourcePlayer';
import { stampOf } from '@/features/morning-feed/watch-page-model';
import './source-sheet.css';

/*
 * A source of the article, over the article (James 2026-11-25): the video from the source's second
 * in a sheet of about 60 % of the screen; the article stays behind it, still readable, so another
 * source can be tapped (the same player changes its video). It closes by dragging it down, the
 * close button, a tap outside or the browser's back (PageWithWatch). The player is not mounted
 * before the sheet is in place (YouTube: no automatic playback before the player is visible) and
 * goes away the moment the sheet starts to leave for the video screen.
 */

/** How a source sheet was closed (usage record). */
export type SheetCloseHow = 'button' | 'outside' | 'drag' | 'back' | 'key';

/** A pointer that moves less than this is a tap: the sheet takes the pointer only after it (px). */
const DRAG_SLOP_PX = 8;
const FLICK_MIN_PX = 24;
/** Dragged down this far it closes: from the text under the player a small phone has ~90 px left. */
const CLOSE_PX = 60;
/** After the slide's own length, the sheet is gone even if the animation never reported. */
const GONE_GRACE_MS = 120;

interface Props {
  target: SourceTarget;
  channel: string;
  title: string;
  /** The sheet is leaving: it slides down, then `onGone`. */
  closing: boolean;
  /** Gone to the video screen: no player any more, the sheet rides away with the article. */
  frozen: boolean;
  player: { current: SourcePlayerHandle | null };
  onClose: (how: SheetCloseHow) => void;
  onGone: () => void;
  onFull: () => void;
  onWatched: (videoId: string, seconds: number) => void;
  onHeight: (h: number) => void;
}

interface Drag {
  id: number;
  x0: number;
  y0: number;
  t0: number;
  dy: number;
  on: boolean;
}

export function SourceSheet(p: Props): JSX.Element {
  const sheet = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const drag = useRef<Drag | null>(null);
  /** The last gesture was a drag: the click that ends it is not a press. */
  const dragged = useRef(false);
  const dy = useRef(0);
  /** The entrance or the way back up after a short drag. */
  const moving = useRef<Animation | null>(null);
  const [entered, setEntered] = useState(false);
  const { ms, ease, closeVelocity } = MOTION.sheet;

  useLayoutEffect(() => {
    const el = sheet.current;
    if (el && typeof el.animate === 'function') {
      moving.current = el.animate(
        prefersReducedMotion()
          ? [{ opacity: 0 }, { opacity: 1 }]
          : [{ transform: 'translate3d(0,100%,0)' }, { transform: 'translate3d(0,0,0)' }],
        { duration: ms, easing: ease }
      );
      moving.current.finished.catch(() => undefined);
    }
    closeBtn.current?.focus({ preventScroll: true });
    const t = window.setTimeout(() => setEntered(true), ms);
    return () => window.clearTimeout(t);
    // one entrance per sheet
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    if (sheet.current) p.onHeight(sheet.current.offsetHeight);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.target.key]);

  const goneRef = useRef(p.onGone);
  goneRef.current = p.onGone;
  useLayoutEffect(() => {
    if (!p.closing) return undefined;
    const el = sheet.current;
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      goneRef.current();
    };
    const t = window.setTimeout(finish, ms + GONE_GRACE_MS);
    if (el && typeof el.animate === 'function') {
      const a = el.animate(
        prefersReducedMotion()
          ? [{ opacity: 1 }, { opacity: 0 }]
          : [
              { transform: `translate3d(0,${dy.current}px,0)` },
              { transform: 'translate3d(0,100%,0)' },
            ],
        { duration: ms, easing: ease, fill: 'forwards' }
      );
      void a.finished.then(finish, () => undefined);
    } else {
      finish();
    }
    return () => {
      done = true;
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.closing]);

  const still = p.closing || p.frozen;
  const closeRef = useRef(p.onClose);
  closeRef.current = p.onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeRef.current('key');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const setY = (v: number): void => {
    dy.current = v;
    if (sheet.current) sheet.current.style.transform = v > 0 ? `translate3d(0,${v}px,0)` : '';
  };
  const springBack = useCallback((): void => {
    const el = sheet.current;
    const from = dy.current;
    setY(0);
    if (el && from > 0 && typeof el.animate === 'function' && !prefersReducedMotion()) {
      moving.current = el.animate(
        [{ transform: `translate3d(0,${from}px,0)` }, { transform: 'translate3d(0,0,0)' }],
        { duration: ms, easing: ease }
      );
      moving.current.finished.catch(() => undefined);
    }
  }, [ms, ease]);

  const onDown = (e: PointerEvent): void => {
    if (still || drag.current || (e.pointerType === 'mouse' && e.button !== 0)) return;
    dragged.current = false;
    drag.current = {
      id: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      t0: e.timeStamp,
      dy: 0,
      on: false,
    };
  };
  const onMove = (e: PointerEvent): void => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const my = e.clientY - d.y0;
    if (!d.on) {
      if (Math.hypot(e.clientX - d.x0, my) < DRAG_SLOP_PX) return;
      // only a downward gesture is the sheet's; any gesture past the slop is no tap any more
      dragged.current = true;
      if (my <= 0 || Math.abs(e.clientX - d.x0) > my) {
        drag.current = null;
        return;
      }
      d.on = true;
      try {
        sheet.current?.setPointerCapture?.(e.pointerId);
      } catch {
        /* the pointer is already gone */
      }
      moving.current?.cancel();
    }
    d.dy = Math.max(0, my);
    setY(d.dy);
  };
  const onUp = (e: PointerEvent): void => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (!d.on) return;
    const v = d.dy / Math.max(1, e.timeStamp - d.t0);
    if (d.dy >= CLOSE_PX || (v >= closeVelocity && d.dy >= FLICK_MIN_PX)) p.onClose('drag');
    else springBack();
  };
  const onCancel = (e: PointerEvent): void => {
    if (drag.current?.id !== e.pointerId) return;
    drag.current = null;
    springBack();
  };
  /**
   * Taking the pointer makes the element under the finger lose its implicit capture, and that
   * loss bubbles up here: only the sheet's own loss ends the drag.
   */
  const onLost = (e: PointerEvent): void => {
    if (e.target === sheet.current) onCancel(e);
  };
  const onClickCapture = (e: MouseEvent): void => {
    if (!dragged.current || e.detail === 0) return;
    dragged.current = false;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div
      ref={sheet}
      className="mf-src"
      role="dialog"
      aria-modal="false"
      aria-label={'출처 영상: ' + p.title}
      data-testid="mf-src-sheet"
      data-closing={p.closing ? '' : undefined}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onCancel}
      onLostPointerCapture={onLost}
      onClickCapture={onClickCapture}
    >
      <div className="mf-src-head" data-testid="mf-src-head">
        <span className="mf-src-grip" aria-hidden="true" />
        <button
          ref={closeBtn}
          type="button"
          className="mf-src-close"
          data-press="soft"
          data-testid="mf-src-close"
          aria-label="닫기"
          onClick={() => p.onClose('button')}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      <div className="mf-src-player" data-testid="mf-src-player">
        {entered && !p.frozen ? (
          <SourcePlayer target={p.target} handle={p.player} onWatched={p.onWatched} />
        ) : null}
      </div>
      <div className="mf-src-info">
        <div className="mf-src-ch" data-testid="mf-src-channel">
          {p.channel}
        </div>
        <div className="mf-src-title" data-testid="mf-src-title">
          {p.title}
        </div>
        <div className="mf-src-foot">
          {p.target.t > 0 ? (
            <div className="mf-src-at" data-testid="mf-src-at">
              {'이 부분 ' + stampOf(p.target.t)}
            </div>
          ) : null}
          <button
            type="button"
            className="mf-src-full"
            data-press="btn"
            data-testid="mf-src-full"
            onClick={p.onFull}
          >
            <span>영상 전체 보기</span>
            <span aria-hidden="true">→</span>
          </button>
        </div>
      </div>
    </div>
  );
}
