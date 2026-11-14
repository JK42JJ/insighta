import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
} from 'react';

import type { PlayerController, PlayerTick } from '@/features/morning-feed/WatchPlayer';
import { usePhoneLandscape } from '@/features/morning-feed/use-phone-landscape';
import { cutInside, leftOut } from '@/features/morning-feed/watch-r3-clip';
import { chapterStamp } from '@/features/morning-feed/watch-design';
import {
  ambientOrDefault,
  CHANNEL_ROW_H,
  feedBlocks,
  HEADER_H,
  immersiveBlocks,
  immersiveHeight,
  sheetTop,
  viewsLengthText,
  type Frame,
} from '@/features/morning-feed/watch-r3-layout';
import {
  CARD_MOVE_MS,
  progressPercent,
  revealDelayMs,
} from '@/features/morning-feed/watch-r3-motion';

/*
 * 시청 screen of design handoff "design_handoff_insighta_watch_v2" (수정 4). One card per video;
 * swipe up for the next, down for the previous. Turning the sound on switches the same card to
 * immersive playback. The player is ONE node in a layer above the current card's player slot:
 * never rebuilt or moved in the DOM, only shown, hidden and translated. When the cards move, the
 * layer slides in with the arriving card and the video is started once more than half of the
 * layer is visible (YouTube: no automatic playback before the player is visible). README §4
 * ("keep the thumbnail until PLAYING") is not built: it would start playback hidden.
 */

/** One video as this screen draws it. Optional blocks are empty when the server sent nothing. */
export interface R3Video {
  key: string;
  videoId?: string;
  title: string;
  channel: string;
  /** Channel icon: first letter, and which of the two icon colours. */
  initial: string;
  altIcon: boolean;
  durationSec: number | null;
  publishedAt?: string;
  /** '3일 전' / '2개월 전'; `fresh` (under 7 days) draws it as a filled pill. */
  ageText: string;
  fresh: boolean;
  /** '조회수 1.2만회'; '' when unknown. */
  viewsText: string;
  thumbUrl?: string;
  /** '#rrggbb' from the server, or undefined. */
  ambient?: string;
  /** Fixture only: the colour of the player slot when there is no thumbnail image. */
  slotBg?: string;
  why: string;
  summary: string;
  checks: string[];
  chapters: Array<{ at: string; title: string }>;
}

export type R3Verdict = 'useful' | 'skip' | 'pass';
/** Per card: 'skip' = passed (swiped on without a verdict). */
export type R3Reaction = 'like' | 'dislike' | 'skip';

/** What the player layer needs from the screen; the live screen renders the YouTube player. */
export interface R3PlayerEvents {
  onReady: () => void;
  onPlaying: (videoId: string) => void;
  onMuted: (muted: boolean) => void;
  onTick: (t: PlayerTick) => void;
  onFailed: (failed: boolean) => void;
}

export interface WatchFeedProps {
  goalTitle: string;
  videos: R3Video[];
  frame: Frame;
  /** First entry: the batch is on its way (skeleton). */
  loading: boolean;
  /** Records a judgment: 좋아 / 별로 when pressed, 넘김 when swiped on without one. */
  onVerdict: (index: number, verdict: R3Verdict) => void;
  /** The last card was passed: the 다 본 뒤 screen. */
  onFinish: () => void;
  onBack: () => void;
  /** The session's sound setting (README: kept for the session) and its setter. */
  sound: boolean;
  onSound: (on: boolean) => void;
  player: { current: PlayerController | null };
  renderPlayer: (events: R3PlayerEvents) => ReactNode;
  /** The first video (initial.idx) starts at this second (a page's source link). */
  startSeconds?: number;
  /**
   * false (a page's videos, 2026-11-14): swiping on records nothing and shows nothing; only
   * 좋아/별로 are recorded, and only real verdicts are shown on cards.
   */
  recordPass?: boolean;
  /** Test hook (fixture): start in this state. */
  initial?: Partial<{
    idx: number;
    maxIdx: number;
    mode: 'feed' | 'imm';
    phase: 'thumb' | 'player';
    reacts: R3Reaction[];
    reacting: 'like' | 'dislike' | null;
    sheet: boolean;
    dragFrac: number;
  }>;
}

/** README §3. */
export const SWIPE_THRESHOLD_PX = 70;
const DRAG_START_PX = 8;
const DOWN_FOLLOW_FIRST = 0.15;
/** A little longer than the move itself, then input is taken again. */
export const SETTLE_MS = CARD_MOVE_MS + 40;
const LIKE_CONFIRM_MS = 1400;
const DISLIKE_ADVANCE_MS = 800;
const WHEEL_MIN_DELTA = 40;
const WHEEL_GAP_MS = 1100;
const CLICK_GUARD_MS = 60;
/** When the player never reports PLAYING (autoplay refused), the line stops running after this. */
export const PLAYER_SHOW_FALLBACK_MS = 2500;

const VERDICT_OF: Record<'like' | 'dislike', R3Verdict> = { like: 'useful', dislike: 'skip' };

function Svg({
  size,
  vb = '0 0 20 20',
  sw = 2.2,
  fill = 'none',
  children,
}: {
  size: number;
  vb?: string;
  sw?: number;
  fill?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox={vb}
      fill={fill}
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const UpArrow = (): JSX.Element => (
  <span className="mf-w3-up">
    <Svg size={16}>
      <path d="M4 13l6-6 6 6" />
    </Svg>
  </span>
);

/** The playback part of the line: width from the last position read, advanced every frame. */
function ProgressFill({
  timeRef,
  videoId,
}: {
  timeRef: { current: (PlayerTick & { at: number }) | null };
  videoId: string;
}): JSX.Element {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const frame = (): void => {
      const t = timeRef.current;
      if (el.current) {
        const pct = t && t.videoId === videoId ? progressPercent(t, performance.now()) : 0;
        el.current.style.width = pct + '%';
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [timeRef, videoId]);
  return <div ref={el} className="mf-w3-line-fill" data-testid="mf-w3-progress" />;
}

export function WatchFeed(p: WatchFeedProps): JSX.Element {
  const init = p.initial ?? {};
  const n = p.videos.length;
  const [idx, setIdx] = useState(init.idx ?? 0);
  // sideways phone on a video: the player alone fills the screen, no card moves until upright
  const sideways = usePhoneLandscape();
  const land = sideways && idx < n && !p.loading;
  const [maxIdx, setMaxIdx] = useState(init.maxIdx ?? init.idx ?? 0);
  const [mode, setMode] = useState<'feed' | 'imm'>(init.mode ?? 'feed');
  const [drag, setDrag] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [settling, setSettling] = useState(false);
  const [phase, setPhase] = useState<'thumb' | 'player'>(init.phase ?? 'thumb');
  const [playerMuted, setPlayerMuted] = useState(!p.sound);
  const [sheet, setSheet] = useState(init.sheet ?? false);
  const [reacts, setReacts] = useState<R3Reaction[]>(init.reacts ?? []);
  const [reacting, setReacting] = useState<'like' | 'dislike' | null>(init.reacting ?? null);
  const [failed, setFailed] = useState(false);
  /** Player layer: offset from its resting place, animated or not, shown or not. */
  const [layer, setLayer] = useState({ y: 0, anim: false, shown: init.phase === 'player' });
  /**
   * During a card move the layer follows the arriving card's player slot frame by frame
   * (2026-11-14: a separate transition started two frames late and from a place that ignored the
   * finger's drag, so the player showed up to 259 px below its slot). React leaves the transform
   * alone meanwhile.
   */
  const [following, setFollowing] = useState(false);
  const viewportEl = useRef<HTMLDivElement>(null);
  const layerEl = useRef<HTMLDivElement>(null);
  const followRaf = useRef<number | null>(null);
  const [ready, setReady] = useState(false);

  const timers = useRef<number[]>([]);
  const st = useRef({ idx, settling, mode, reacts, reacting, sound: p.sound });
  st.current = { idx, settling, mode, reacts, reacting, sound: p.sound };
  const gesture = useRef({ y0: 0, down: false, drag: false, at: 0 });
  const wheelAt = useRef(0);
  /** Last position read per video: a card you come back to resumes there (James 2026-11-13). */
  const positions = useRef(
    new Map<string, number>(
      p.startSeconds && p.videos[init.idx ?? 0]?.videoId
        ? [[p.videos[init.idx ?? 0]!.videoId, p.startSeconds]]
        : []
    )
  );
  const recordPass = p.recordPass ?? true;
  const timeRef = useRef<(PlayerTick & { at: number }) | null>(null);
  const loadSeq = useRef(0);

  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);
  useEffect(() => {
    const t = timers.current;
    return () => {
      t.forEach((x) => window.clearTimeout(x));
      if (followRaf.current != null) cancelAnimationFrame(followRaf.current);
    };
  }, []);

  /** Puts the layer on card `i`'s player slot every frame until stopped. */
  const followSlot = useCallback((i: number) => {
    if (followRaf.current != null) cancelAnimationFrame(followRaf.current);
    const step = (): void => {
      const vp = viewportEl.current;
      const el = layerEl.current;
      const slot = vp?.querySelectorAll<HTMLElement>('[data-testid="mf-w3-slot"]')[i];
      if (vp && el && slot) {
        const y = slot.getBoundingClientRect().top - vp.getBoundingClientRect().top - el.offsetTop;
        el.style.transform = 'translateY(' + Math.round(y) + 'px)';
      }
      followRaf.current = requestAnimationFrame(step);
    };
    step();
  }, []);
  const stopFollow = useCallback(() => {
    if (followRaf.current != null) cancelAnimationFrame(followRaf.current);
    followRaf.current = null;
    setFollowing(false);
  }, []);

  const f = p.frame;
  const imm = mode === 'imm';
  const immH = immersiveHeight(f);
  const cur = p.videos[Math.min(idx, n - 1)];

  const cards = useMemo(
    () =>
      p.videos.map((v, i) => {
        const fb = feedBlocks(f, {
          why: !!v.why,
          summary: !!v.summary,
          checks: v.checks.length > 0,
          points: v.chapters.length,
        });
        const ib = immersiveBlocks(f, {
          why: !!v.why,
          summary: !!v.summary,
          next: i + 1 < n,
          afterNext: i + 2 < n,
          chapters: v.chapters.length,
        });
        return { fb, ib, h: imm ? immH : fb.height };
      }),
    [p.videos, f, imm, immH, n]
  );

  /** Starts card i's video in the layer (muted in the feed, the session's sound when immersive). */
  const startVideo = useCallback(
    (i: number) => {
      const v = p.videos[i];
      const ctl = p.player.current;
      if (!v?.videoId || !ctl) return;
      const s = st.current;
      setLayer((l) => ({ ...l, shown: true }));
      ctl.load(v.videoId, positions.current.get(v.videoId) ?? 0, s.mode === 'imm' && s.sound);
      const seq = ++loadSeq.current;
      later(() => {
        if (loadSeq.current === seq) setPhase('player');
      }, PLAYER_SHOW_FALLBACK_MS);
    },
    [p.videos, p.player, later]
  );

  // first video: once the player is ready and the batch is here, the current card is visible
  useEffect(() => {
    if (!ready || p.loading || n === 0) return;
    startVideo(st.current.idx);
    // only on readiness, not on every card change (moves start their own video)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, p.loading, n]);

  const viewportH = f.vh - f.safeTop - HEADER_H - (imm ? f.safeBottom : 0);

  /** Moves to card `next` (forward or back); the layer comes with the arriving card. */
  const move = useCallback(
    (next: number, dir: 1 | -1, reactsAfter: R3Reaction[]) => {
      const s = st.current;
      p.player.current?.pause();
      setReacts(reactsAfter);
      setIdx(next);
      setMaxIdx((m) => Math.max(m, next));
      setDrag(0);
      setDragging(false);
      setSettling(true);
      setPhase('thumb');
      setSheet(false);
      setReacting(null);
      setFailed(false);
      loadSeq.current++;
      const arriving = next < n;
      const distance = dir === 1 ? (cards[s.idx]?.h ?? 0) : (cards[next]?.h ?? 0);
      // the layer rests at 0 when the move ends; until then it follows the arriving slot
      setLayer({ y: 0, anim: false, shown: false });
      if (arriving) {
        setFollowing(true);
        followSlot(next);
        const delay = revealDelayMs({
          dir,
          distance,
          viewportH,
          slotTop: CHANNEL_ROW_H,
          playerH: f.playerH,
        });
        later(() => {
          if (st.current.idx === next) startVideo(next);
        }, delay);
      }
      later(() => {
        stopFollow();
        setSettling(false);
        if (!arriving) p.onFinish();
      }, SETTLE_MS);
    },
    [cards, f.playerH, followSlot, later, n, p, startVideo, stopFollow, viewportH]
  );

  const advance = useCallback(
    (kind: R3Reaction) => {
      const s = st.current;
      if (s.settling || p.loading || s.idx >= n) return;
      const r = s.reacts.slice();
      if (kind === 'skip') {
        // swiped on: 넘김 only for a card without a verdict (좋아/별로 stay as they are)
        if (!r[s.idx] && recordPass) {
          r[s.idx] = 'skip';
          p.onVerdict(s.idx, 'pass');
        }
      } else {
        r[s.idx] = kind;
      }
      move(s.idx + 1, 1, r);
    },
    [move, n, p, recordPass]
  );

  const back = useCallback(() => {
    const s = st.current;
    if (s.settling || p.loading) return;
    if (s.idx === 0) {
      setDrag(0);
      setDragging(false);
      return;
    }
    move(s.idx - 1, -1, s.reacts);
  }, [move, p.loading]);

  /** 좋아·별로 can't be changed; a passed card can still get one (README §3). */
  const react = (kind: 'like' | 'dislike'): void => {
    const s = st.current;
    const r = s.reacts[s.idx];
    if (s.settling || s.reacting || r === 'like' || r === 'dislike') return;
    const next = s.reacts.slice();
    next[s.idx] = kind;
    setReacts(next);
    setReacting(kind);
    p.onVerdict(s.idx, VERDICT_OF[kind]);
    if (kind === 'like') later(() => setReacting(null), LIKE_CONFIRM_MS);
    else later(() => advance('dislike'), DISLIKE_ADVANCE_MS);
  };

  // keyboard (desktop): ↓ next, ↑ previous
  useEffect(() => {
    const kd = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        advance('skip');
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        back();
      }
    };
    window.addEventListener('keydown', kd);
    return () => window.removeEventListener('keydown', kd);
  }, [advance, back]);

  const onPointerDown = (e: ReactPointerEvent): void => {
    if (st.current.settling || p.loading || land) return;
    gesture.current = { ...gesture.current, y0: e.clientY, down: true, drag: false };
  };
  const onPointerMove = (e: ReactPointerEvent): void => {
    const g = gesture.current;
    if (!g.down) return;
    const dy = e.clientY - g.y0;
    if (!g.drag && Math.abs(dy) < DRAG_START_PX) return;
    g.drag = true;
    setDragging(true);
    setDrag(dy < 0 || st.current.idx > 0 ? dy : dy * DOWN_FOLLOW_FIRST);
  };
  const onPointerUp = (e: ReactPointerEvent): void => {
    const g = gesture.current;
    if (!g.down) return;
    g.down = false;
    if (!g.drag) return;
    g.at = Date.now();
    const dy = e.clientY - g.y0;
    if (dy < -SWIPE_THRESHOLD_PX) advance('skip');
    else if (dy > SWIPE_THRESHOLD_PX && st.current.idx > 0) back();
    else {
      setDrag(0);
      setDragging(false);
    }
  };
  const onWheel = (e: ReactWheelEvent): void => {
    const now = Date.now();
    if (land) return;
    if (Math.abs(e.deltaY) < WHEEL_MIN_DELTA || now - wheelAt.current < WHEEL_GAP_MS) return;
    wheelAt.current = now;
    if (e.deltaY > 0) advance('skip');
    else back();
  };
  /** A drag that just ended is not also a tap. */
  const tap = (fn: () => void) => (): void => {
    if (gesture.current.drag && Date.now() - gesture.current.at < CLICK_GUARD_MS) return;
    fn();
  };

  // ── player events ──
  const events: R3PlayerEvents = {
    onReady: () => setReady(true),
    onPlaying: (id) => {
      if (id === p.videos[st.current.idx]?.videoId) {
        loadSeq.current++;
        setPhase('player');
      }
    },
    onMuted: (m) => {
      setPlayerMuted(m);
      if (st.current.mode === 'feed') {
        // YouTube's own control turned the sound on in the feed = immersive playback
        if (!m) {
          setMode('imm');
          setSheet(false);
          p.onSound(true);
        }
        return;
      }
      // immersive: the setting follows the player (our button, YouTube's control, or blocked sound)
      p.onSound(!m);
    },
    onTick: (t) => {
      timeRef.current = { ...t, at: performance.now() };
      if (t.seconds > 0) positions.current.set(t.videoId, t.seconds);
    },
    onFailed: setFailed,
  };

  /** The button shows the state now: the feed always plays without sound. */
  const shownMuted = !imm || playerMuted;
  const tapMute = tap(() => {
    if (shownMuted) {
      setMode('imm');
      setSheet(false);
      setPlayerMuted(false);
      p.onSound(true);
      p.player.current?.soundOn();
    } else {
      setPlayerMuted(true);
      p.onSound(false);
      p.player.current?.soundOff();
    }
  });
  const closeImmersive = (): void => {
    setMode('feed');
    setSheet(false);
    p.player.current?.soundOff();
  };

  const dragFrac = init.dragFrac ?? 0;
  const moving = dragging || dragFrac !== 0;
  const offs = cards.reduce<number[]>((a, c) => (a.push(a[a.length - 1] + c.h), a), [0]);
  const curH = cards[Math.min(idx, n - 1)]?.h ?? 0;
  const dy = dragFrac !== 0 ? -dragFrac * curH : drag;
  const stackY = Math.round(-offs[Math.min(idx, n)] + dy);
  const playing = phase === 'player' && !settling && !p.loading && idx < n;
  const curAmb = ambientOrDefault(cur?.ambient);
  const endH = f.vh - f.safeTop - HEADER_H;

  const rootStyle = {
    '--w3-amb': curAmb,
    '--w3-safe-top': f.safeTop + 'px',
    '--w3-safe-bottom': f.safeBottom + 'px',
  } as CSSProperties;

  const sheetVideo = cur;
  const hasSheet =
    !!sheetVideo && (!!sheetVideo.why || !!sheetVideo.summary || sheetVideo.chapters.length > 0);

  return (
    <div
      className="mf-w3-root"
      data-mode={mode}
      data-land={land ? '' : undefined}
      data-testid="mf-w3-watch"
      style={rootStyle}
    >
      <div className="mf-w3-watch">
        <div className="mf-w3-head">
          <button
            type="button"
            className="mf-w3-icon-btn"
            data-testid="mf-watch-back"
            aria-label={imm ? '닫기' : '뒤로'}
            onClick={tap(() => (imm ? closeImmersive() : p.onBack()))}
          >
            <Svg size={20}>
              <path d={imm ? 'M4 7l6 6 6-6' : 'M12 4l-6 6 6 6'} />
            </Svg>
          </button>
          <div className="mf-w3-goal" data-testid="mf-watch-goal-name">
            {p.goalTitle}
          </div>
          {n > 0 ? (
            <div className="mf-w3-counter" data-testid="mf-watch-counter">
              <b>{Math.min(idx, n - 1) + 1}</b>
              <span>{' / ' + n}</span>
            </div>
          ) : null}
        </div>

        <div
          ref={viewportEl}
          className="mf-w3-viewport"
          data-testid="mf-w3-viewport"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
        >
          <div
            className="mf-w3-stack"
            data-anim={dragging ? undefined : ''}
            style={{ transform: 'translateY(' + stackY + 'px)' }}
          >
            {p.videos.map((v, i) => {
              const { fb, ib, h } = cards[i];
              const isCur = i === idx;
              const r = reacts[i];
              const liked = r === 'like';
              const dis = r === 'dislike';
              const rx = isCur ? reacting : null;
              const kind: R3Reaction | null =
                rx ?? (recordPass ? (i < maxIdx ? (r ?? 'skip') : null) : (r ?? null));
              const nx = p.videos[i + 1];
              const nx2 = p.videos[i + 2];
              const lowHidden = imm && (i < idx || (isCur && moving));
              const meta = viewsLengthText(v.viewsText, v.durationSec);
              const showWhy = imm ? ib.showWhy : fb.showWhy;
              const showSum = imm ? ib.showSummary : fb.showSummary;
              const ptRows = imm ? ib.chapterRows : fb.pointRows;
              const style = {
                height: h + 'px',
                '--w3-card-amb': ambientOrDefault(v.ambient),
              } as CSSProperties;
              return (
                <div
                  key={v.key}
                  className="mf-w3-card"
                  data-mode={mode}
                  data-dim={rx === 'dislike' ? '' : undefined}
                  data-testid="mf-w3-card"
                  data-current={isCur ? '' : undefined}
                  style={style}
                >
                  <div className="mf-w3-ch-row">
                    <div className="mf-w3-av" data-alt={v.altIcon ? '' : undefined}>
                      {v.initial}
                    </div>
                    <div className="mf-w3-ch">{v.channel}</div>
                    {v.ageText ? (
                      <div
                        className={v.fresh ? 'mf-w3-age-pill' : 'mf-w3-age'}
                        data-testid="mf-w3-age"
                      >
                        {v.ageText}
                      </div>
                    ) : null}
                    {isCur ? (
                      <button
                        type="button"
                        className="mf-w3-mute"
                        data-muted={shownMuted ? '' : undefined}
                        data-testid="mf-w3-mute"
                        aria-label="음소거"
                        onClick={tapMute}
                      >
                        <span className="mf-w3-mute-face">
                          <Svg size={18} vb="0 0 24 24">
                            <path d="M11 5L6 9H3v6h3l5 4z" />
                            <path
                              d={
                                shownMuted
                                  ? 'M15 9l6 6M21 9l-6 6'
                                  : 'M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13'
                              }
                            />
                          </Svg>
                        </span>
                      </button>
                    ) : (
                      <div className="mf-w3-ch-spacer" />
                    )}
                  </div>
                  <div
                    className="mf-w3-slot"
                    style={
                      {
                        height: f.playerH + 'px',
                        '--w3-slot-bg': v.slotBg ?? ambientOrDefault(v.ambient),
                      } as CSSProperties
                    }
                    data-testid="mf-w3-slot"
                  >
                    {v.thumbUrl ? <img src={v.thumbUrl} alt="" draggable={false} /> : null}
                  </div>
                  <div className="mf-w3-line">
                    {isCur && !playing ? <div className="mf-w3-line-run" /> : null}
                    {isCur && playing && v.videoId ? (
                      <ProgressFill timeRef={timeRef} videoId={v.videoId} />
                    ) : null}
                  </div>
                  {isCur && failed ? (
                    <div className="mf-w3-failed" data-testid="mf-watch-player-failed">
                      <span>재생할 수 없습니다</span>
                      {v.videoId ? (
                        <a
                          href={'https://www.youtube.com/watch?v=' + v.videoId}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          YouTube에서 열기
                        </a>
                      ) : null}
                    </div>
                  ) : null}

                  <div
                    className="mf-w3-info"
                    data-testid="mf-w3-info"
                    onClick={(e) => {
                      const el = e.currentTarget;
                      tap(() => {
                        if (!isCur) return;
                        const hidden =
                          leftOut({
                            why: v.why,
                            summary: v.summary,
                            chapters: v.chapters.length,
                            showWhy,
                            showSummary: showSum,
                            chapterRows: ptRows,
                          }) || cutInside(el);
                        // nothing cut off: the panel would repeat the card
                        if (hidden) setSheet(true);
                      })();
                    }}
                  >
                    {showWhy ? (
                      <div className="mf-w3-why" data-testid="mf-reason">
                        <div className="mf-w3-why-k">이 영상을 고른 이유</div>
                        <div className="mf-w3-why-t">{v.why}</div>
                        {!imm && fb.showChecks ? (
                          <div className="mf-w3-checks">
                            {v.checks.map((k) => (
                              <div key={k} className="mf-w3-check">
                                ✓ {k}
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    <div className="mf-w3-pad">
                      <div className="mf-w3-title" data-testid="mf-watch-title">
                        {v.title}
                      </div>
                      <div className="mf-w3-meta" data-testid="mf-w3-meta">
                        {meta}
                      </div>
                      {showSum ? (
                        <div className="mf-w3-sum" data-testid="mf-oneliner">
                          <div className="mf-w3-label">한 줄 요약</div>
                          <div className="mf-w3-sum-t">{v.summary}</div>
                        </div>
                      ) : null}
                      {ptRows > 0 ? (
                        <div className="mf-w3-pts" data-testid="mf-chapters">
                          <div className="mf-w3-label">영상 설명란에서 추린 순서</div>
                          {v.chapters.slice(0, ptRows).map((c, k) => (
                            <div key={k} className="mf-w3-pt">
                              <span className="mf-w3-pt-at">{chapterStamp(c.at)}</span>
                              <span>{c.title}</span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="mf-w3-icons" data-testid="mf-watch-actions">
                    <button
                      type="button"
                      className="mf-w3-react"
                      data-kind="dislike"
                      data-on={dis ? '' : undefined}
                      data-off={liked ? '' : undefined}
                      data-pop={rx === 'dislike' ? '' : undefined}
                      data-testid="mf-watch-skip"
                      aria-label="별로"
                      onClick={tap(() => isCur && react('dislike'))}
                    >
                      <Svg size={20} vb="0 0 24 24" sw={2}>
                        <path d="M17 14V2" />
                        <path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z" />
                      </Svg>
                    </button>
                    <button
                      type="button"
                      className="mf-w3-react"
                      data-kind="like"
                      data-on={liked ? '' : undefined}
                      data-off={dis ? '' : undefined}
                      data-pop={rx === 'like' ? '' : undefined}
                      data-testid="mf-watch-like"
                      aria-label="좋아"
                      onClick={tap(() => isCur && react('like'))}
                    >
                      <svg
                        width="21"
                        height="21"
                        viewBox="0 0 24 24"
                        fill={liked ? 'currentColor' : 'none'}
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M12 20.5s-7.5-4.6-7.5-10A4.2 4.2 0 0 1 12 8a4.2 4.2 0 0 1 7.5 2.5c0 5.4-7.5 10-7.5 10z" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className="mf-w3-react"
                      data-kind="share"
                      data-testid="mf-watch-share"
                      aria-label="공유"
                      onClick={tap(() => {
                        if (!navigator.share) return;
                        navigator
                          .share({
                            title: v.title,
                            ...(v.videoId
                              ? { url: 'https://www.youtube.com/watch?v=' + v.videoId }
                              : {}),
                          })
                          .catch(() => undefined);
                      })}
                    >
                      <Svg size={20} vb="0 0 24 24">
                        <path d="M12 15V4M8 8l4-4 4 4M5 13v6h14v-6" />
                      </Svg>
                    </button>
                    {kind ? (
                      <div className="mf-w3-confirm" data-kind={kind} data-testid="mf-w3-confirm">
                        {kind !== 'skip' ? (
                          <Svg size={14} sw={2.6}>
                            <path d="M4 10.5l4 4 8-9" />
                          </Svg>
                        ) : null}
                        {kind === 'like' ? '좋아' : kind === 'dislike' ? '별로' : '넘김'}
                      </div>
                    ) : null}
                    <div className="mf-w3-grow" />
                  </div>
                  {!imm ? <div className="mf-w3-gap" /> : null}
                  {imm && ib.nextBig && nx
                    ? [nx, ...(ib.nextSecond && nx2 ? [nx2] : [])].map((x, k) => (
                        <div
                          key={x.key}
                          className="mf-w3-next mf-w3-next-big"
                          data-hidden={lowHidden ? '' : undefined}
                          data-testid="mf-w3-next"
                        >
                          <div
                            className="mf-w3-next-thumb"
                            style={
                              {
                                '--w3-next-bg': x.slotBg ?? ambientOrDefault(x.ambient),
                              } as CSSProperties
                            }
                          >
                            {x.thumbUrl ? <img src={x.thumbUrl} alt="" draggable={false} /> : null}
                          </div>
                          <div className="mf-w3-next-body">
                            <div className="mf-w3-next-ch">{x.channel}</div>
                            <div className="mf-w3-next-t">{x.title}</div>
                          </div>
                          {k === 0 ? <UpArrow /> : null}
                        </div>
                      ))
                    : null}
                  {imm && !ib.nextBig ? (
                    <div
                      className="mf-w3-next mf-w3-next-line"
                      data-hidden={lowHidden ? '' : undefined}
                      data-testid="mf-w3-next"
                    >
                      <UpArrow />
                      {nx ? (
                        <div className="mf-w3-next-text">
                          {[nx.channel, nx.title].filter((x) => x).join(' · ')}
                        </div>
                      ) : (
                        <div className="mf-w3-next-kick">오늘 본 것</div>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
            <div className="mf-w3-end" style={{ height: endH + 'px' }} data-testid="mf-w3-end">
              <div className="mf-w3-tick" />
              <div className="mf-w3-kick">오늘 본 것</div>
              <div className="mf-w3-end-goal">{p.goalTitle}</div>
            </div>
          </div>

          <div
            className="mf-w3-player-layer"
            data-shown={layer.shown && idx < n && !p.loading ? '' : undefined}
            ref={layerEl}
            data-anim={layer.anim && !dragging && !following ? '' : undefined}
            data-testid="mf-watch-player"
            style={{
              height: f.playerH + 'px',
              transform: following
                ? undefined
                : 'translateY(' + Math.round(layer.y + (moving ? dy : 0)) + 'px)',
            }}
          >
            {p.renderPlayer(events)}
          </div>

          {p.loading ? (
            <div className="mf-w3-loading" data-testid="mf-w3-loading">
              <div className="mf-w3-sk-row">
                <div className="mf-w3-sk-av" />
                <div className="mf-w3-sk-bar" data-short="" />
              </div>
              <div className="mf-w3-sk-player" style={{ height: f.playerH + 'px' }} />
              <div className="mf-w3-line">
                <div className="mf-w3-line-run" />
              </div>
              <div className="mf-w3-sk-why" />
              <div className="mf-w3-sk-text">
                <div className="mf-w3-sk-bar" style={{ width: '88%' }} />
                <div className="mf-w3-sk-bar" style={{ width: '56%' }} />
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {sheet && hasSheet && sheetVideo ? (
        <div className="mf-w3-sheet" data-testid="mf-w3-sheet" style={{ top: sheetTop(f) + 'px' }}>
          <div className="mf-w3-sheet-head">
            <div className="mf-w3-sheet-kick">더 보기</div>
            <button
              type="button"
              className="mf-w3-icon-btn"
              aria-label="닫기"
              onClick={() => setSheet(false)}
            >
              <Svg size={18} vb="0 0 24 24" sw={2.4}>
                <path d="M6 6l12 12M18 6L6 18" />
              </Svg>
            </button>
          </div>
          <div className="mf-w3-sheet-body">
            <div className="mf-w3-sheet-title">{sheetVideo.title}</div>
            <div className="mf-w3-sheet-meta">
              {[sheetVideo.ageText, viewsLengthText(sheetVideo.viewsText, sheetVideo.durationSec)]
                .filter((x) => x)
                .join(' · ')}
            </div>
            {sheetVideo.why ? (
              <div className="mf-w3-sheet-sec" data-first="">
                <div className="mf-w3-sheet-k" data-why="">
                  이 영상을 고른 이유
                </div>
                <div className="mf-w3-sheet-why">{sheetVideo.why}</div>
                {sheetVideo.checks.length > 0 ? (
                  <div className="mf-w3-sheet-checks">
                    {sheetVideo.checks.map((k) => (
                      <div key={k} className="mf-w3-sheet-check">
                        ✓ {k}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
            {sheetVideo.summary ? (
              <div className="mf-w3-sheet-sec">
                <div className="mf-w3-sheet-k">한 줄 요약</div>
                <div className="mf-w3-sheet-sum">{sheetVideo.summary}</div>
              </div>
            ) : null}
            {sheetVideo.chapters.length > 0 ? (
              <div className="mf-w3-sheet-sec" data-rule="">
                <div className="mf-w3-sheet-k">영상 설명란에서 추린 순서</div>
                {sheetVideo.chapters.map((c, k) => (
                  <div key={k} className="mf-w3-sheet-pt">
                    <span className="mf-w3-sheet-pt-at">{chapterStamp(c.at)}</span>
                    <span>{c.title}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
