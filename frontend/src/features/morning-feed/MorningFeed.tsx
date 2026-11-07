import {
  useEffect,
  useReducer,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import { cssText as css } from '@/features/morning-feed/css-text';
import { useFontsReady } from '@/features/morning-feed/use-fonts-ready';
import { YouTubePlayer, type SoundController } from '@/features/morning-feed/YouTubePlayer';
import './mf.css';

/*
 * 오늘의 픽 — port of morning-feed.reference.html (design original, v1).
 * Logic, timings, curves and style values are copied from the reference; only the
 * colors are named tokens (mf.css) and the data/judgment hooks are props.
 */

export interface FeedCard {
  bg: string;
  ini: string;
  thumb: string;
  dur: string;
  ago: string;
  ch: string;
  chMeta: string;
  title: string;
  cell: string;
  focus?: string;
  why: string;
  /** Live data only: the YouTube video, its thumbnail, and the badge colour rule (under 7 days). */
  videoId?: string;
  thumbUrl?: string;
  fresh?: boolean;
}

export interface FeedCell {
  label: string;
  short: string;
  dom: number;
}

export interface JudgeEvent {
  index: number;
  verdict: 'useful' | 'skip';
  shownPosition: number;
}

interface MorningFeedProps {
  cards: FeedCard[];
  grid: FeedCell[];
  onJudge: (e: JudgeEvent) => void;
  onUndo: () => void;
}

interface FeedState {
  c: number;
  i: number;
  dx: number;
  dy: number;
  drag: boolean;
  anim: boolean;
  leaving: boolean;
  play: boolean;
  res: Record<number, 'keep' | 'skip'>;
  toast: string | null;
  undoable: boolean;
  pulse: boolean;
  picker: boolean;
  picking: number;
  onboard: boolean;
  demo: boolean;
}

const EDGE_PX = 24;

export function MorningFeed({ cards, grid, onJudge, onUndo }: MorningFeedProps) {
  const [, tick] = useReducer((n: number) => n + 1, 0);
  const q = useRef(new URLSearchParams(window.location.search)).current;
  const appRef = useRef<HTMLDivElement>(null);
  const soundCtl = useRef<SoundController | null>(null);
  const [soundOn, setSoundOn] = useState(false);
  const fontText = useRef(
    [
      '오늘 전체 목표 칸 고르기 담았어요 넘겼어요 되돌리기 담기 어디부터 볼까요 새 영상 개 담았어요 지금 하나 보기 다른 칸 고르기 일 전 주 전 개월 전',
      ...cards.flatMap((c) => [c.thumb, c.title, c.ch, c.chMeta, c.cell, c.why, c.ini]),
      ...grid.map((g) => g.short + g.label),
    ].join(' ')
  ).current;
  const fontsReady = useFontsReady(fontText);

  const init = useRef<FeedState | null>(null);
  if (init.current === null) {
    const s: FeedState = {
      c: 4,
      i: 0,
      dx: 0,
      dy: 0,
      drag: false,
      anim: true,
      leaving: false,
      play: false,
      res: {},
      toast: null,
      undoable: false,
      pulse: false,
      picker: false,
      picking: -1,
      onboard: q.get('onboard') !== '0',
      demo: false,
    };
    if (q.get('cell') != null)
      s.c = Math.max(0, Math.min(8, parseInt(q.get('cell') ?? '', 10) || 0));
    if (deckFor(cards, grid, s.c).length === 0) s.c = 4; // never start on a cell with 0 cards (v1.2)
    const deckOfInit = (c: number) => deckFor(cards, grid, c);
    const st = q.get('state');
    if (st === 'keep') {
      s.onboard = false;
      s.dx = 118;
      s.anim = false;
    }
    if (st === 'picker') {
      s.onboard = false;
      s.picker = true;
    }
    if (st === 'toast') {
      s.onboard = false;
      s.res = { 0: 'keep' };
      s.i = 1;
      s.toast = '담았어요';
      s.undoable = true;
    }
    if (st === 'done') {
      s.onboard = false;
      deckOfInit(s.c).forEach((key, j) => {
        s.res[key] = j % 3 === 0 ? 'keep' : 'skip';
      });
      s.i = deckOfInit(s.c).length;
    }
    init.current = s;
  }
  const S = init.current;

  const timers = useRef<{ obt: number[]; tt: number | null }>({ obt: [], tt: null });
  const gesture = useRef({ sx: 0, sy: 0, moved: 0, vx: 0, vy: 0, lt: 0, lx: 0, ly: 0 });
  const lastKey = useRef<number | null>(null);
  const dotsFor = useRef(-1);

  const set = (p: Partial<FeedState>) => {
    Object.assign(S, p);
    tick();
  };
  const deckOf = (c: number) => deckFor(cards, grid, c);

  const later = (fn: () => void, ms: number) => window.setTimeout(fn, ms);

  const showToast = (text: string, undoable: boolean) => {
    if (timers.current.tt != null) window.clearTimeout(timers.current.tt);
    set({ toast: text, undoable });
    timers.current.tt = later(() => set({ toast: null }), undoable ? 3000 : 1600);
  };

  const endOnboard = () => {
    timers.current.obt.forEach((t) => window.clearTimeout(t));
    timers.current.obt = [];
    if (S.onboard) set({ onboard: false, demo: false });
  };

  const commit = (kind: 'keep' | 'skip') => {
    if (S.leaving) return;
    const out = kind === 'keep' ? { dx: 460, dy: 0 } : { dx: 0, dy: -900 };
    set({
      leaving: true,
      drag: false,
      anim: true,
      play: false,
      dx: out.dx,
      dy: out.dy,
      pulse: kind === 'keep',
    });
    if (kind === 'keep') {
      try {
        navigator.vibrate?.(10);
      } catch {
        /* not supported */
      }
    }
    later(() => {
      const deck = deckOf(S.c);
      const res = { ...S.res };
      res[deck[S.i]] = kind;
      lastKey.current = deck[S.i];
      onJudge({
        index: deck[S.i],
        verdict: kind === 'keep' ? 'useful' : 'skip',
        shownPosition: S.i,
      });
      set({ res, i: S.i + 1, anim: false, dx: 0, dy: 420, pulse: false });
      later(() => set({ anim: true, dy: 0, leaving: false }), 30);
      showToast(kind === 'keep' ? '담았어요' : '넘겼어요', true);
    }, 260);
  };

  // M10: opening the sheet adds one history entry, so Back (Android button, gesture) closes the sheet only
  const popOwnEntry = () => {
    try {
      if ((window.history.state as { mfPicker?: boolean } | null)?.mfPicker) window.history.back();
    } catch {
      /* history unavailable */
    }
  };
  const openPicker = () => {
    if (S.picker) return;
    try {
      window.history.pushState({ ...(window.history.state ?? {}), mfPicker: true }, '');
    } catch {
      /* history unavailable */
    }
    set({ picker: true });
  };
  const closePicker = () => {
    if (!S.picker) return;
    set({ picker: false });
    popOwnEntry();
  };

  const pickCell = (k: number) => {
    if (S.picking >= 0) return;
    set({ picking: k });
    later(() => {
      if (timers.current.tt != null) window.clearTimeout(timers.current.tt);
      set({ picker: false, c: k, i: 0, anim: false, dx: 0, dy: 520, play: false, toast: null });
      popOwnEntry();
      later(() => {
        set({ anim: true, dy: 0, picking: -1 });
        showToast(grid[k].short + ' · ' + deckOf(k).length + '개', false);
      }, 60);
    }, 260);
  };

  // first-run demo of the keep gesture
  useEffect(() => {
    if (!fontsReady || !S.onboard) return undefined;
    const at = (ms: number, fn: () => void) => timers.current.obt.push(window.setTimeout(fn, ms));
    at(900, () => set({ demo: true, anim: true, dx: 84 }));
    at(1900, () => set({ dx: 0 }));
    at(2700, () => set({ demo: false }));
    at(4200, () => set({ onboard: false }));
    const own = timers.current;
    return () => {
      own.obt.forEach((t) => window.clearTimeout(t));
      if (own.tt != null) window.clearTimeout(own.tt);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fontsReady]);

  // Phone page setup for this screen only; everything is put back when the screen closes.
  useEffect(() => {
    const undo: Array<() => void> = [];
    const vp = document.querySelector('meta[name="viewport"]');
    if (vp) {
      const before = vp.getAttribute('content') ?? '';
      if (!/viewport-fit=cover/.test(before))
        vp.setAttribute('content', before + ', viewport-fit=cover');
      undo.push(() => vp.setAttribute('content', before));
    }
    const html = document.documentElement;
    const prev = [html.style.overscrollBehavior, document.body.style.overscrollBehavior];
    html.style.overscrollBehavior = 'none';
    document.body.style.overscrollBehavior = 'none';
    undo.push(() => {
      html.style.overscrollBehavior = prev[0];
      document.body.style.overscrollBehavior = prev[1];
    });
    const add = (tag: string, attrs: Record<string, string>) => {
      const el = document.createElement(tag);
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
      document.head.appendChild(el);
      undo.push(() => el.remove());
    };
    add('link', { rel: 'manifest', href: '/morning-cards.webmanifest' });
    add('meta', { name: 'theme-color', content: '#0E0E11' });
    add('meta', { name: 'apple-mobile-web-app-capable', content: 'yes' });
    add('meta', { name: 'mobile-web-app-capable', content: 'yes' });
    add('meta', { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' });
    return () => undo.forEach((fn) => fn());
  }, []);

  useEffect(() => {
    const onPop = () => {
      if (S.picker) set({ picker: false });
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── render values (same expressions as the reference) ──
  const s = S;
  const deck = deckOf(s.c);
  const n = deck.length;
  const done = s.i >= n;
  const card = cards[deck[Math.min(s.i, n - 1)]] || cards[0]; // empty-deck guard (v1.2)
  const ease =
    s.anim && !s.drag
      ? s.demo
        ? 'transform 0.7s cubic-bezier(0.45,0,0.2,1)'
        : 'transform 0.34s cubic-bezier(0.32,0.72,0,1)'
      : 'none';
  const rot = s.dx > 0 ? (s.dx / 30).toFixed(2) : '0';
  const ko = Math.max(0, Math.min(1, s.dx / 90));
  const fresh =
    card.fresh !== undefined ? card.fresh : /일 전/.test(card.ago) && parseInt(card.ago, 10) <= 7;
  const keepCount = Object.keys(s.res).filter((k) => s.res[Number(k)] === 'keep').length;
  const unseenAll = cards.filter((_x, k) => !s.res[k]).length;
  if (dotsFor.current !== s.c) dotsFor.current = s.c;

  // ── input ──
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const isDone = S.i >= deckOf(S.c).length;
    if (S.leaving || isDone || S.picker) return;
    const left = appRef.current ? appRef.current.getBoundingClientRect().left : 0;
    if (e.clientX - left < EDGE_PX) return; // iOS edge-swipe back (M4)
    endOnboard();
    e.currentTarget.setPointerCapture(e.pointerId);
    const g = gesture.current;
    g.sx = e.clientX;
    g.sy = e.clientY;
    g.moved = 0;
    g.vx = 0;
    g.vy = 0;
    g.lt = e.timeStamp;
    g.lx = e.clientX;
    g.ly = e.clientY;
    set({ drag: true });
  };
  const pending = useRef<{ dx: number; dy: number } | null>(null);
  const frame = useRef<number | null>(null);
  const flushDrag = () => {
    if (frame.current != null) {
      window.cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    if (pending.current) {
      const p = pending.current;
      pending.current = null;
      set({ dx: p.dx, dy: p.dy });
    }
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!S.drag) return;
    const g = gesture.current;
    const dt = Math.max(1, e.timeStamp - g.lt);
    g.vx = 0.8 * ((e.clientX - g.lx) / dt) + 0.2 * g.vx;
    g.vy = 0.8 * ((e.clientY - g.ly) / dt) + 0.2 * g.vy;
    g.lt = e.timeStamp;
    g.lx = e.clientX;
    g.ly = e.clientY;
    const x = e.clientX - g.sx;
    const y = e.clientY - g.sy;
    g.moved = Math.max(Math.abs(x), Math.abs(y));
    pending.current =
      Math.abs(x) > Math.abs(y) ? { dx: Math.max(0, x), dy: 0 } : { dx: 0, dy: Math.min(0, y) };
    if (frame.current == null) {
      frame.current = window.requestAnimationFrame(() => {
        frame.current = null;
        flushDrag();
      });
    }
  };
  const onUp = () => {
    if (!S.drag) return;
    flushDrag();
    const g = gesture.current;
    // distance, or a fast flick (0.5 px/ms and 30 px)
    if (S.dx > 100 || (g.vx > 0.5 && S.dx > 30)) commit('keep');
    else if (S.dy < -90 || (g.vy < -0.5 && S.dy < -30)) commit('skip');
    else set({ drag: false, anim: true, dx: 0, dy: 0 });
  };
  const onPlayer = () => {
    if (gesture.current.moved > 6) return;
    set({ play: !S.play });
  };
  const onUndoClick = () => {
    if (!S.undoable || S.i === 0 || lastKey.current == null) return;
    if (timers.current.tt != null) window.clearTimeout(timers.current.tt);
    const res = { ...S.res };
    delete res[lastKey.current];
    lastKey.current = null;
    onUndo();
    set({ res, i: S.i - 1, toast: null, anim: false, dy: -300 });
    later(() => set({ anim: true, dy: 0 }), 30);
  };

  const showToastNow = !!s.toast && !done;
  const keptKeys = deck.filter((key) => s.res[key] === 'keep');

  // text is laid out once, with the final font metrics (offline: shown after a timeout)
  if (!fontsReady) return <div className="mf-page" />;

  return (
    <div className="mf-page">
      <div
        ref={appRef}
        lang="ko"
        className={'mf-app' + (q.get('noanim') === '1' ? ' mf-noanim' : '')}
        data-testid="mf-root"
      >
        <div
          style={css(
            'position: absolute; top: 0; left: 0; right: 0; height: 60px; z-index: 6; padding: env(safe-area-inset-top, 0px) max(16px, env(safe-area-inset-right, 0px)) 0 max(16px, env(safe-area-inset-left, 0px)); display: flex; align-items: center; justify-content: space-between; background: var(--mf-bg)'
          )}
        >
          <button
            type="button"
            data-testid="mf-chip"
            aria-label="목표 칸 고르기"
            onClick={() => openPicker()}
            style={css(
              'height: 36px; padding: 0 14px 0 12px; border-radius: 999px; border: none; background: var(--mf-surface); color: var(--mf-fg); font-size: 14px; font-weight: 700; display: flex; align-items: center; gap: 8px; cursor: pointer; transition: transform 0.2s cubic-bezier(.34,1.4,.64,1); transform: scale(' +
                (s.picker ? 0.94 : 1) +
                ')'
            )}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--mf-butter)"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="3" y="3" width="5" height="5" rx="1" />
              <rect x="9.5" y="3" width="5" height="5" rx="1" />
              <rect x="16" y="3" width="5" height="5" rx="1" />
              <rect x="3" y="9.5" width="5" height="5" rx="1" />
              <rect x="9.5" y="9.5" width="5" height="5" rx="1" />
              <rect x="16" y="9.5" width="5" height="5" rx="1" />
              <rect x="3" y="16" width="5" height="5" rx="1" />
              <rect x="9.5" y="16" width="5" height="5" rx="1" />
              <rect x="16" y="16" width="5" height="5" rx="1" />
            </svg>
            <span>{grid[s.c].short}</span>
          </button>
          <div
            data-testid="mf-tray"
            aria-label="오늘 담은 영상"
            style={css(
              'height: 36px; padding: 0 14px; border-radius: 999px; background: var(--mf-surface); display: flex; align-items: center; gap: 6px; transition: transform 0.2s cubic-bezier(.34,1.4,.64,1); transform: scale(' +
                (s.pulse ? 1.2 : 1) +
                ')'
            )}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="var(--mf-accent)"
              aria-hidden="true"
            >
              <path d="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2z" />
            </svg>
            <span
              style={css("font-family: 'Inter', sans-serif; font-size: 14px; font-weight: 700")}
            >
              {String(keepCount)}
            </span>
          </div>
        </div>

        <div style={{ display: done ? 'none' : 'block' }}>
          <div
            data-testid="mf-card"
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            style={css(
              'position: absolute; top: calc(60px + env(safe-area-inset-top, 0px)); left: 0; right: 0; height: 640px; background: var(--mf-bg); touch-action: none; cursor: grab; transform: translate(' +
                s.dx +
                'px, ' +
                s.dy +
                'px) rotate(' +
                rot +
                'deg); will-change: transform; transform-origin: 50% 100%; transition: ' +
                ease
            )}
          >
            <button type="button" className="mf-sr" onClick={() => commit('keep')}>
              담기
            </button>
            <button type="button" className="mf-sr" onClick={() => commit('skip')}>
              넘기기
            </button>
            <div
              data-testid="mf-player"
              onClick={onPlayer}
              style={{
                ...css(
                  'height: 219px; position: relative; display: flex; align-items: flex-end; padding: 0 20px 20px; box-sizing: border-box; cursor: pointer'
                ),
                background: card.bg,
              }}
            >
              {card.videoId ? (
                <YouTubePlayer
                  videoId={card.videoId}
                  active={!s.leaving && !s.picker && !done}
                  controller={soundCtl}
                  onSound={setSoundOn}
                />
              ) : (
                <>
                  <div
                    style={css(
                      'font-size: 30px; line-height: 1.12; font-weight: 900; letter-spacing: -0.02em; white-space: pre-line; color: var(--mf-white)'
                    )}
                  >
                    {card.thumb}
                  </div>
                  <div
                    style={css(
                      'position: absolute; left: 0; bottom: 0; height: 3px; background: var(--mf-white); transition: width 0.3s; width: ' +
                        (s.play ? '42%' : '18%') +
                        '; opacity: 0.85'
                    )}
                  />
                </>
              )}
            </div>
            <div
              style={css(
                'position: relative; padding: 20px 20px 0; display: flex; flex-direction: column; gap: 14px'
              )}
            >
              <div
                style={css(
                  'display: flex; gap: 8px; align-items: center; font-size: 13px; color: var(--mf-muted)'
                )}
              >
                <span
                  data-testid="mf-fresh"
                  style={css(
                    'height: 26px; padding: 0 10px; border-radius: 999px; display: inline-flex; align-items: center; font-weight: 700; ' +
                      (fresh
                        ? 'background: var(--mf-accent); color: var(--mf-ink)'
                        : 'background: var(--mf-surface); color: var(--mf-why)')
                  )}
                >
                  {card.ago}
                </span>
                <span style={css("font-family: 'Inter', sans-serif")}>{card.dur}</span>
                {card.videoId ? (
                  <button
                    type="button"
                    data-testid="mf-sound"
                    aria-label={soundOn ? '소리 끄기' : '소리 켜기'}
                    onPointerDown={(ev) => ev.stopPropagation()}
                    onClick={() => soundCtl.current?.toggleSound()}
                    style={css(
                      'margin-left: auto; height: 26px; padding: 0 10px; border: none; border-radius: 999px; display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 700; cursor: pointer; background: ' +
                        (soundOn ? 'var(--mf-accent)' : 'var(--mf-surface)') +
                        '; color: ' +
                        (soundOn ? 'var(--mf-ink)' : 'var(--mf-why)')
                    )}
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M4 9v6h4l5 4V5L8 9H4z" />
                      {soundOn ? (
                        <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />
                      ) : (
                        <path d="M17 9l5 6M22 9l-5 6" />
                      )}
                    </svg>
                    {soundOn ? '소리 켬' : '소리 켜기'}
                  </button>
                ) : null}
              </div>
              <div
                data-testid="mf-title"
                style={css(
                  'font-size: 23px; line-height: 1.38; font-weight: 700; letter-spacing: -0.02em'
                )}
              >
                {card.title}
              </div>
              <div style={css('display: flex; align-items: center; gap: 10px')}>
                <div
                  style={{
                    ...css(
                      'width: 32px; height: 32px; border-radius: 50%; color: var(--mf-white); font-size: 13px; font-weight: 700; display: grid; place-items: center'
                    ),
                    background: card.bg,
                  }}
                >
                  {card.ini}
                </div>
                <div style={css('display: flex; flex-direction: column')}>
                  <span style={css('font-size: 14px; font-weight: 700')}>{card.ch}</span>
                  <span style={css('font-size: 12px; color: var(--mf-muted)')}>{card.chMeta}</span>
                </div>
              </div>
              <div
                data-testid="mf-fit"
                style={css(
                  'border-radius: 16px; padding: 14px 16px; display: flex; flex-direction: column; gap: 8px; transition: background 0.15s, box-shadow 0.15s; background: ' +
                    (ko > 0.3 ? 'var(--mf-fit-keep)' : 'var(--mf-fit)') +
                    '; box-shadow: ' +
                    (ko > 0.3 ? 'inset 0 0 0 1.5px var(--mf-accent)' : 'none')
                )}
              >
                <div style={css('display: flex; align-items: center; gap: 8px')}>
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--mf-butter)"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <rect x="3" y="3" width="7" height="7" rx="1.5" />
                    <rect x="14" y="3" width="7" height="7" rx="1.5" />
                    <rect x="3" y="14" width="7" height="7" rx="1.5" />
                    <rect x="14" y="14" width="7" height="7" rx="1.5" />
                  </svg>
                  <span style={css('font-size: 13px; font-weight: 700; color: var(--mf-butter)')}>
                    {card.cell}
                  </span>
                </div>
                <div style={css('font-size: 14px; line-height: 1.55; color: var(--mf-why)')}>
                  {card.why}
                </div>
              </div>
              <div
                data-testid="mf-keepmark"
                style={css(
                  'position: absolute; top: 50%; left: 50%; width: 96px; height: 96px; margin: -48px 0 0 -48px; border-radius: 50%; background: var(--mf-accent); display: grid; place-items: center; box-shadow: 0 10px 30px var(--mf-accent-glow); pointer-events: none; opacity: ' +
                    ko +
                    '; transform: scale(' +
                    (0.5 + 0.5 * ko).toFixed(2) +
                    ')'
                )}
              >
                <svg
                  width="40"
                  height="40"
                  viewBox="0 0 24 24"
                  fill="var(--mf-white)"
                  aria-hidden="true"
                >
                  <path d="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2z" />
                </svg>
              </div>
            </div>
          </div>

          <div
            style={css(
              'position: absolute; left: 20px; right: 20px; bottom: max(26px, env(safe-area-inset-bottom, 0px)); z-index: 5; display: flex; flex-direction: column; gap: 14px'
            )}
          >
            <div
              data-testid="mf-toast"
              style={css(
                'align-self: center; height: 44px; padding: 0 6px 0 18px; border-radius: 999px; background: var(--mf-fg); color: var(--mf-ink); align-items: center; gap: 12px; box-shadow: 0 8px 24px var(--mf-shadow-toast); display: ' +
                  (showToastNow ? 'flex' : 'none')
              )}
            >
              <span style={css('font-size: 14px; font-weight: 700')}>{s.toast || ''}</span>
              <button
                type="button"
                data-testid="mf-undo"
                onClick={onUndoClick}
                style={css(
                  'height: 34px; padding: 0 14px; border-radius: 999px; border: none; background: var(--mf-ink); color: var(--mf-fg); font-size: 13px; font-weight: 700; cursor: pointer'
                )}
              >
                되돌리기
              </button>
            </div>
            <div
              data-testid="mf-onboard"
              style={css(
                'align-self: center; height: 34px; padding: 0 14px; border-radius: 999px; background: var(--mf-accent-wash); color: var(--mf-accent-soft); font-size: 14px; font-weight: 700; display: flex; align-items: center; gap: 6px; transition: opacity 0.4s ease, transform 0.4s ease; opacity: ' +
                  (s.onboard && !done ? 1 : 0) +
                  '; transform: translateY(' +
                  (s.onboard ? 0 : 6) +
                  'px)'
              )}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--mf-accent)"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
              담기
            </div>
            <div
              data-testid="mf-dots"
              style={css(
                'align-self: center; height: 22px; padding: 0 9px; border-radius: 11px; background: var(--mf-dots-bg); backdrop-filter: blur(20px) saturate(180%); -webkit-backdrop-filter: blur(20px) saturate(180%); display: flex; align-items: center; gap: 6px'
              )}
            >
              {deck.map((key, k) => {
                const cur = k === s.i && !done;
                const rk = s.res[key];
                const bg = cur
                  ? 'var(--mf-white)'
                  : rk
                    ? rk === 'keep'
                      ? 'var(--mf-accent)'
                      : 'var(--mf-dot-skip)'
                    : 'var(--mf-dot-rest)';
                return (
                  <div
                    key={key}
                    style={css(
                      'width: ' +
                        (cur ? '18px' : '6px') +
                        '; height: 6px; border-radius: 3px; background: ' +
                        bg +
                        '; transition: width 0.35s cubic-bezier(.34,1.4,.64,1), background 0.25s ease'
                    )}
                  />
                );
              })}
            </div>
          </div>
        </div>

        <div
          data-testid="mf-done"
          style={css(
            'position: absolute; top: calc(60px + env(safe-area-inset-top, 0px)); left: 0; right: 0; bottom: 0; padding: 28px 20px 28px; flex-direction: column; gap: 22px; display: ' +
              (done ? 'flex' : 'none')
          )}
        >
          <div style={css('display: flex; flex-direction: column; gap: 6px')}>
            <div style={css('font-size: 14px; color: var(--mf-muted)')}>
              {grid[s.c].short + ' · ' + n + '개 중'}
            </div>
            <div style={css('display: flex; align-items: baseline; gap: 8px')}>
              <span
                style={css(
                  "font-family: 'Inter', sans-serif; font-size: 64px; font-weight: 700; letter-spacing: -0.04em; line-height: 1; color: var(--mf-accent)"
                )}
              >
                {String(keptKeys.length)}
              </span>
              <span style={css('font-size: 22px; font-weight: 700')}>개 담았어요</span>
            </div>
          </div>
          <div style={css('display: flex; flex-direction: column; gap: 12px')}>
            {keptKeys.map((key) => {
              const c = cards[key];
              return (
                <div key={key} style={css('display: flex; gap: 12px; align-items: center')}>
                  <div
                    style={{
                      ...css('width: 104px; height: 58px; border-radius: 10px; flex: none'),
                      background: c.bg,
                      ...(c.thumbUrl
                        ? {
                            backgroundImage: 'url(' + c.thumbUrl + ')',
                            backgroundSize: 'cover',
                            backgroundPosition: 'center',
                          }
                        : {}),
                    }}
                  />
                  <div style={css('display: flex; flex-direction: column; gap: 3px; min-width: 0')}>
                    <span style={css('font-size: 14px; line-height: 1.4; font-weight: 700')}>
                      {c.title}
                    </span>
                    <span style={css('font-size: 12px; color: var(--mf-butter)')}>{c.cell}</span>
                  </div>
                </div>
              );
            })}
          </div>
          <div style={css('margin-top: auto; display: flex; flex-direction: column; gap: 10px')}>
            <button
              type="button"
              data-testid="mf-watch"
              style={css(
                'height: 56px; border-radius: 16px; border: none; background: var(--mf-accent); color: var(--mf-ink); font-size: 16px; font-weight: 700; cursor: pointer'
              )}
            >
              지금 하나 보기
            </button>
            <button
              type="button"
              data-testid="mf-other"
              onClick={() => openPicker()}
              style={css(
                'height: 52px; border-radius: 16px; border: none; background: var(--mf-surface); color: var(--mf-fg); font-size: 15px; font-weight: 700; cursor: pointer'
              )}
            >
              다른 칸 고르기
            </button>
          </div>
        </div>

        <div
          data-testid="mf-scrim"
          onClick={() => closePicker()}
          style={css(
            'position: absolute; inset: 0; z-index: 20; background: var(--mf-scrim); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); transition: opacity 0.28s ease; opacity: ' +
              (s.picker ? 1 : 0) +
              '; pointer-events: ' +
              (s.picker ? 'auto' : 'none')
          )}
        />
        <div
          data-testid="mf-sheet"
          style={css(
            "position: absolute; left: 8px; right: 8px; top: calc(56px + env(safe-area-inset-top, 0px)); z-index: 21; padding: 8px 14px 18px; border-radius: 38px; font-family: -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif; background: var(--mf-sheet); backdrop-filter: blur(30px) saturate(180%); -webkit-backdrop-filter: blur(30px) saturate(180%); box-shadow: 0 40px 80px var(--mf-shadow-sheet), inset 0 0.5px 0 var(--mf-sheet-edge); display: flex; flex-direction: column; gap: 16px; transform-origin: 20% 0%; transition: transform 0.42s cubic-bezier(.34,1.25,.64,1), opacity 0.22s ease; opacity: " +
              (s.picker ? 1 : 0) +
              '; transform: ' +
              (s.picker ? 'scale(1) translateY(0)' : 'scale(0.6) translateY(-30px)') +
              '; pointer-events: ' +
              (s.picker ? 'auto' : 'none')
          )}
        >
          <div style={css('display: flex; justify-content: center')}>
            <div
              style={css(
                'width: 36px; height: 5px; border-radius: 3px; background: var(--mf-handle)'
              )}
            />
          </div>
          <div
            style={css(
              'display: flex; align-items: flex-end; justify-content: space-between; padding: 2px 6px 0'
            )}
          >
            <div style={css('display: flex; flex-direction: column; gap: 2px')}>
              <div style={css('font-size: 28px; font-weight: 700; letter-spacing: 0.01em')}>
                어디부터 볼까요
              </div>
              <div style={css('font-size: 15px; color: var(--mf-label2)')}>
                {'새 영상 ' + unseenAll}
              </div>
            </div>
            <button
              type="button"
              data-testid="mf-sheet-close"
              aria-label="닫기"
              onClick={() => closePicker()}
              style={css(
                'width: 30px; height: 30px; border-radius: 50%; border: none; background: var(--mf-fill); display: grid; place-items: center; cursor: pointer; margin-bottom: 4px'
              )}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--mf-label2)"
                strokeWidth="3.2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
          <div
            style={css(
              'display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); column-gap: 12px; row-gap: 16px'
            )}
          >
            {grid.map((g, k) => {
              const keys = deckOf(k);
              const unseen = keys.filter((key) => !s.res[key]);
              const left = unseen.length;
              const center = g.dom === -1;
              const sel = k === s.c;
              const picking = k === s.picking;
              const empty = left === 0;
              const delay = (Math.abs(Math.floor(k / 3) - 1) + Math.abs((k % 3) - 1)) * 45;
              const repKey = (unseen.length ? unseen : keys)[0];
              const rep = repKey != null ? cards[repKey] : null;
              const mk = (unseen.length >= 4 ? unseen : keys).slice(0, 4);
              return (
                <button
                  key={g.label}
                  type="button"
                  data-testid={'mf-cell-' + k}
                  aria-label={g.label + ', ' + (empty ? '다 봤어요' : left + '개 남음')}
                  onClick={() => {
                    if (deckOf(k).length === 0) return; // empty cell: dimmed "0", no move
                    pickCell(k);
                  }}
                  style={css(
                    'border: none; background: none; padding: 0; cursor: pointer; display: flex; flex-direction: column; align-items: stretch; gap: 0; text-align: left; font-family: inherit; min-width: 0; ' +
                      'transition: transform 0.42s cubic-bezier(.34,1.3,.64,1) ' +
                      (s.picker ? delay : 0) +
                      'ms, opacity 0.26s ease ' +
                      (s.picker ? delay : 0) +
                      'ms; ' +
                      'opacity: ' +
                      (s.picker ? (empty ? 0.4 : 1) : 0) +
                      '; transform: scale(' +
                      (picking ? 1.06 : s.picker ? 1 : 0.8) +
                      ')'
                  )}
                >
                  <span
                    style={{
                      ...css(
                        'position: relative; display: block; aspect-ratio: 1 / 1; border-radius: 12px; overflow: hidden; box-shadow: ' +
                          (sel
                            ? '0 0 0 2px var(--mf-bg), 0 0 0 4px var(--mf-white)'
                            : '0 6px 16px -6px var(--mf-shadow-cell)')
                      ),
                      background: center || !rep ? 'var(--mf-tile)' : rep.bg,
                    }}
                  >
                    {center ? (
                      <span
                        style={css(
                          'position: absolute; inset: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 2px'
                        )}
                      >
                        {[0, 1, 2, 3].map((j) => (
                          <span
                            key={j}
                            style={{
                              display: 'block',
                              background: mk[j] != null ? cards[mk[j]].bg : 'transparent',
                              ...(mk[j] != null && cards[mk[j]].thumbUrl
                                ? {
                                    backgroundImage: 'url(' + cards[mk[j]].thumbUrl + ')',
                                    backgroundSize: 'cover',
                                    backgroundPosition: 'center',
                                  }
                                : {}),
                            }}
                          />
                        ))}
                      </span>
                    ) : rep && rep.thumbUrl ? (
                      <img
                        src={rep.thumbUrl}
                        alt=""
                        draggable={false}
                        style={{
                          position: 'absolute',
                          inset: 0,
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                        }}
                      />
                    ) : (
                      <span
                        style={css(
                          'position: absolute; left: 9px; right: 8px; bottom: 8px; font-size: 13px; line-height: 1.15; font-weight: 800; letter-spacing: -0.02em; color: var(--mf-white); white-space: pre-line'
                        )}
                      >
                        {rep ? rep.thumb : ''}
                      </span>
                    )}
                  </span>
                  <span
                    style={css(
                      'margin-top: 8px; font-size: 14px; font-weight: 600; letter-spacing: -0.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--mf-white)'
                    )}
                  >
                    {g.short}
                  </span>
                  <span style={css('margin-top: 1px; font-size: 12px; color: var(--mf-label2)')}>
                    {String(left)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function deckFor(cards: FeedCard[], grid: FeedCell[], c: number): number[] {
  const g = grid[c];
  const all = cards.map((_x, k) => k);
  return g.dom === -1 ? all : all.filter((k) => cards[k].cell === g.label);
}
