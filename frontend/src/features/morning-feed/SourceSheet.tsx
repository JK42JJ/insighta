import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';

import { MOTION } from '@/features/morning-feed/motion-tokens';
import {
  SourcePlayer,
  type SourcePlayerHandle,
  type SourceTarget,
} from '@/features/morning-feed/SourcePlayer';
import type { PlayRange } from '@/features/morning-feed/play-range';
import { stampOf } from '@/features/morning-feed/watch-page-model';
import { youtubeThumb } from '@/features/morning-feed/feed-format';
import './source-sheet.css';

/*
 * The sources of a sentence under the article (order 2026-11-25 B5-2, design "Insighta App
 * Prototype", 읽으며 보기). It does not block: the article over it scrolls and its sentences are
 * tapped as before. One dark panel in two forms: 'base' (grip, player, one line) and 'mini', the
 * same panel gone down to a bar when it is dragged down: the video pauses and its thumbnail
 * shrinks into the bar's left; a tap or an upward swipe brings it back where it stopped, a downward
 * one closes. The panel and its one player stay mounted when it is put away, so a later sentence
 * does not start a new one.
 *
 * YouTube's required minimum functionality decides three things here: the player keeps its size
 * and is hidden instead of getting small (at least 200x200 px); nothing is drawn over it while it
 * is shown; and the bar's thumbnail, which starts playback, is at least 120x70 px (96x54 in the
 * design).
 */

export type SheetForm = 'base' | 'mini' | 'closed';
/** How a source sheet was closed (usage record). */
export type SheetCloseHow = 'button' | 'drag' | 'back' | 'key' | 'list' | 'leave';
/** How it changed between the base form and the bar (usage record). */
export type SheetFormHow = 'drag' | 'tap' | 'key';

/** A pointer that moves less than this is a tap: the sheet takes the pointer only after it (px). */
const DRAG_SLOP_PX = 8;
/** A sideways swipe this long turns to the next or previous source. */
const TURN_PX = 48;
const FLICK_MIN_PX = 14;
/**
 * The base form dragged down this far becomes the bar. Its line of text is the last 52 px of the
 * screen, so a finger that starts there has little more than this below it.
 */
const MINI_PX = 24;
/** The bar dragged this far up or down opens the base form or closes. */
const BAR_PX = 24;
/**
 * The slide is fast first: more than half of the player is in view after this share of it, and
 * only then may the video start (YouTube).
 */
const LIVE_SHARE = 0.5;

interface Props {
  target: SourceTarget;
  channel: string;
  title: string;
  /** Which of the sentence's sources is shown (0-based) and how many there are. */
  at: number;
  count: number;
  onTurn: (to: number) => void;
  form: SheetForm;
  /** No slide (the browser's own back drew one, or the sheet rides away with the article). */
  instant: boolean;
  /** Gone to the video screen: no player any more, the sheet rides away with the article. */
  frozen: boolean;
  player: { current: SourcePlayerHandle | null };
  onForm: (form: 'base' | 'mini', how: SheetFormHow) => void;
  onClose: (how: SheetCloseHow) => void;
  onFull: () => void;
  onWatched: (videoId: string, seconds: number) => void;
  onRange: (r: PlayRange, sid: string | undefined) => void;
  /** The heights of the two forms: the article keeps that much room under its last line. */
  onHeight: (h: { base: number; mini: number }) => void;
}

interface Drag {
  id: number;
  x0: number;
  y0: number;
  t0: number;
  dy: number;
  on: boolean;
  /** A sideways gesture: how far; null = not one. */
  dx: number | null;
}

export function SourceSheet(p: Props): JSX.Element {
  const sheet = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const barBtn = useRef<HTMLButtonElement>(null);
  /** The form on screen: the first one is drawn closed, so it slides in. */
  const [form, setForm] = useState<SheetForm>('closed');
  /** How it is drawn: while it goes away it stays as it was. */
  const [look, setLook] = useState<'base' | 'mini'>('base');
  const [live, setLive] = useState(false);
  const { ms } = MOTION.source;

  useLayoutEffect(() => {
    if (!sheet.current || !bar.current) return undefined;
    const measure = (): void => {
      if (!sheet.current || !bar.current) return;
      p.onHeight({ base: sheet.current.offsetHeight, mini: bar.current.offsetHeight });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(sheet.current);
    ro.observe(bar.current);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    // the place it leaves from is drawn before the new one, so the browser slides between them
    void sheet.current?.offsetHeight;
    sheet.current?.style.removeProperty('--src-drag');
    setForm(p.form);
    setLive(false);
    if (p.form !== 'closed') setLook(p.form);
    if (p.form === 'mini') return undefined;
    const t =
      p.form === 'base'
        ? window.setTimeout(() => setLive(true), ms * LIVE_SHARE)
        : window.setTimeout(() => setLook('base'), ms);
    return () => window.clearTimeout(t);
  }, [p.form, ms]);

  useEffect(() => {
    if (form === 'base') closeBtn.current?.focus({ preventScroll: true });
    else if (form === 'mini') barBtn.current?.focus({ preventScroll: true });
  }, [form]);

  const still = p.frozen || p.form === 'closed';
  const closeRef = useRef(p.onClose);
  closeRef.current = p.onClose;
  useEffect(() => {
    if (still) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeRef.current('key');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [still]);

  const turn = (to: number): void => {
    if (!still && p.count > 1) p.onTurn((to + p.count) % p.count);
  };

  const isBar = p.form === 'mini';
  const drag = useDrag(sheet, {
    off: still,
    sideways: p.count > 1 && !isBar,
    allow: (dy) => isBar || dy > 0,
    // the bar itself only leaves downwards
    clamp: (dy) => Math.max(0, dy),
    onEnd: (dy, fast) => {
      const far = Math.abs(dy) >= (isBar ? BAR_PX : MINI_PX);
      if (!far && !(fast && Math.abs(dy) >= FLICK_MIN_PX)) return false;
      if (!isBar) p.onForm('mini', 'drag');
      else if (dy < 0) p.onForm('base', 'drag');
      else p.onClose('drag');
      return true;
    },
    onTurn: (step) => turn(p.at + step),
  });

  const { t, videoId } = p.target;
  const stopped = look === 'mini' ? (p.player.current?.position() ?? null) : null;
  const from = t > 0 ? stampOf(t) + '부터' : '';

  return (
    <div
      ref={sheet}
      className="mf-src"
      role="dialog"
      aria-modal="false"
      aria-label={'출처 영상: ' + p.title}
      data-testid="mf-src-sheet"
      data-form={form}
      data-look={look}
      data-instant={p.instant ? '' : undefined}
      {...drag}
    >
      <div className="mf-src-head" data-testid="mf-src-head">
        <span className="mf-src-grip" aria-hidden="true" />
      </div>
      {/* under the player until it has the video (never over it); it shrinks into the bar */}
      <div className="mf-src-media" data-testid="mf-src-media" aria-hidden="true">
        <img src={youtubeThumb(videoId)} alt="" draggable={false} />
      </div>
      <div className="mf-src-player" data-testid="mf-src-player" data-live={live ? '' : undefined}>
        {!p.frozen ? (
          <SourcePlayer
            target={p.target}
            live={live && p.form === 'base'}
            handle={p.player}
            onWatched={p.onWatched}
            onRange={p.onRange}
          />
        ) : null}
      </div>
      <div className="mf-src-info" data-testid="mf-src-info">
        {p.count > 1 ? (
          <button
            type="button"
            className="mf-src-turn"
            data-press="icon"
            data-testid="mf-src-turn"
            aria-label={'다음 근거 영상 (' + (p.at + 1) + '/' + p.count + ')'}
            onClick={() => turn(p.at + 1)}
          >
            <span aria-live="polite" data-testid="mf-src-turn-n">
              {p.at + 1 + '/' + p.count}
            </span>
            <span aria-hidden="true">›</span>
          </button>
        ) : null}
        <div className="mf-src-line" data-testid="mf-src-line">
          <span className="mf-src-ch">{p.channel}</span>
          {from ? <span className="mf-src-from">{from}</span> : null}
        </div>
        <IconButton testId="mf-src-full" label="영상 전체 보기" onClick={p.onFull}>
          <rect x="3.5" y="5" width="13" height="10" rx="2" />
          <path d="M8.5 8.2v3.6l3-1.8z" fill="currentColor" stroke="none" />
        </IconButton>
        <IconButton
          testId="mf-src-close"
          label="닫기"
          onClick={() => p.onClose('button')}
          inner={closeBtn}
        >
          <path d="M5 5l10 10M15 5L5 15" />
        </IconButton>
      </div>
      <div ref={bar} className="mf-src-bar" data-testid="mf-src-bar">
        <button
          ref={barBtn}
          type="button"
          className="mf-src-bar-open"
          data-testid="mf-src-bar-open"
          aria-label={'이어서 보기: ' + p.title}
          onClick={(e) => !still && p.onForm('base', e.detail === 0 ? 'key' : 'tap')}
        >
          <span className="mf-src-bar-at" data-testid="mf-src-bar-at">
            {stopped === null ? from : stampOf(stopped) + ' · 멈춤'}
          </span>
          <span className="mf-src-bar-t">{[p.channel, p.title].filter((x) => x).join(' · ')}</span>
        </button>
        <IconButton testId="mf-src-bar-close" label="닫기" onClick={() => p.onClose('button')}>
          <path d="M5 5l10 10M15 5L5 15" />
        </IconButton>
      </div>
    </div>
  );
}

interface DragOptions {
  off: boolean;
  sideways: boolean;
  /** A vertical gesture of this direction is the sheet's. */
  allow: (dy: number) => boolean;
  clamp?: (dy: number) => number;
  /** True: the gesture did something; false: the element goes back. */
  onEnd: (dy: number, fast: boolean) => boolean;
  onTurn?: (step: 1 | -1) => void;
}

/** The element follows the finger after the slop; the click that ends a drag presses nothing. */
function useDrag(el: { current: HTMLElement | null }, o: DragOptions): Record<string, unknown> {
  const drag = useRef<Drag | null>(null);
  const dragged = useRef(false);
  const { closeVelocity } = MOTION.sheet;

  const move = (dy: number | null): void => {
    const e = el.current;
    if (!e) return;
    const y = dy === null ? 0 : (o.clamp?.(dy) ?? dy);
    e.toggleAttribute('data-drag', dy !== null);
    if (y !== 0) e.style.setProperty('--src-drag', y + 'px');
    else e.style.removeProperty('--src-drag');
  };
  const take = (id: number): void => {
    try {
      // the pointer is kept, so a gesture that ends outside still counts
      el.current?.setPointerCapture?.(id);
    } catch {
      /* the pointer is already gone */
    }
  };
  const onPointerDown = (e: PointerEvent): void => {
    if (o.off || drag.current || (e.pointerType === 'mouse' && e.button !== 0)) return;
    dragged.current = false;
    drag.current = {
      id: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      t0: e.timeStamp,
      dy: 0,
      on: false,
      dx: null,
    };
  };
  const onPointerMove = (e: PointerEvent): void => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const mx = e.clientX - d.x0;
    const my = e.clientY - d.y0;
    if (d.dx !== null) {
      d.dx = mx;
      return;
    }
    if (!d.on) {
      if (Math.hypot(mx, my) < DRAG_SLOP_PX) return;
      dragged.current = true;
      if (Math.abs(mx) > Math.abs(my)) {
        if (!o.sideways) drag.current = null;
        else {
          d.dx = mx;
          take(e.pointerId);
        }
        return;
      }
      if (!o.allow(my)) {
        drag.current = null;
        return;
      }
      d.on = true;
      take(e.pointerId);
    }
    d.dy = o.allow(my) ? my : 0;
    move(d.dy);
  };
  const onPointerUp = (e: PointerEvent): void => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (d.dx !== null) {
      if (d.dx <= -TURN_PX) o.onTurn?.(1);
      else if (d.dx >= TURN_PX) o.onTurn?.(-1);
      return;
    }
    if (!d.on) return;
    const v = Math.abs(d.dy) / Math.max(1, e.timeStamp - d.t0);
    el.current?.removeAttribute('data-drag');
    // a gesture that counted slides on from here to the new form
    if (!o.onEnd(d.dy, v >= closeVelocity)) move(null);
  };
  const onPointerCancel = (e: PointerEvent): void => {
    if (drag.current?.id !== e.pointerId) return;
    const on = drag.current.on;
    drag.current = null;
    if (!on) return;
    o.onEnd(0, false);
    move(null);
  };
  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    /**
     * Taking the pointer makes the element under the finger lose its implicit capture, and that
     * loss bubbles up here: only the element's own loss ends the drag.
     */
    onLostPointerCapture: (e: PointerEvent): void => {
      if (e.target === el.current) onPointerCancel(e);
    },
    onClickCapture: (e: MouseEvent): void => {
      if (!dragged.current || e.detail === 0) return;
      dragged.current = false;
      e.preventDefault();
      e.stopPropagation();
    },
  };
}

function IconButton({
  testId,
  label,
  onClick,
  inner,
  children,
}: {
  testId: string;
  label: string;
  onClick: () => void;
  inner?: { current: HTMLButtonElement | null };
  children: ReactNode;
}): JSX.Element {
  return (
    <button
      ref={inner}
      type="button"
      className="mf-src-icon"
      data-press="icon"
      data-testid={testId}
      aria-label={label}
      onClick={onClick}
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {children}
      </svg>
    </button>
  );
}
