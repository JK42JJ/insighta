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

import {
  ambientOrDefault,
  channelMetaText,
  clockText,
  feedBlocks,
  HEADER_H,
  immersiveBlocks,
  immersiveHeight,
  topBlockHeight,
  type Frame,
} from '@/features/morning-feed/watch-r3-layout';
import { chapterStamp } from '@/features/morning-feed/watch-design';
import { counterText, segmentStates } from '@/features/morning-feed/watch-list';

/*
 * 시청 screen of design handoff "design_handoff_insighta_watch_v2" (수정 3, A안): one card per
 * video, swipe up for the next one; turning the sound on switches the same card to immersive
 * playback. The player is ONE node in a layer above the current card's player slot (README
 * "플레이어 위치 고정"): it is never rebuilt or moved in the DOM, only shown, hidden and translated.
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
type Reaction = 'like' | 'dislike' | 'skip';

/** What the player layer needs from the screen; the live screen renders the YouTube player. */
export interface R3PlayerApi {
  videoId: string;
  active: boolean;
  /** The layer is visible: playback may start (never before; YouTube autoplay rule). */
  play: boolean;
  onShown: (videoId: string) => void;
  onMuted: (muted: boolean) => void;
  onTick: (t: { videoId: string; seconds: number; duration: number }) => void;
  onFailed: (failed: boolean) => void;
}

export interface R3SoundControl {
  soundOn: () => void;
  soundOff: () => void;
}

export interface WatchFeedProps {
  goalTitle: string;
  videos: R3Video[];
  frame: Frame;
  /** First entry: the batch is on its way (skeleton). */
  loading: boolean;
  /** Records a judgment: 좋아 / 별로 when pressed, 넘김 when swiped up without one. */
  onVerdict: (index: number, verdict: R3Verdict) => void;
  /** The last card was passed: the 다 본 뒤 screen. */
  onFinish: () => void;
  onBack: () => void;
  renderPlayer: (api: R3PlayerApi) => ReactNode;
  sound: { current: R3SoundControl | null };
  /** Test hook (fixture): start in this state. */
  initial?: Partial<{
    idx: number;
    mode: 'feed' | 'imm';
    muted: boolean;
    phase: 'thumb' | 'player';
    reacts: Reaction[];
    reacting: 'like' | 'dislike' | null;
    sheet: boolean;
    dragFrac: number;
    playing: boolean;
  }>;
}

/** README §7. */
export const SWIPE_THRESHOLD_PX = 70;
const DRAG_START_PX = 8;
const DOWN_FOLLOW = 0.15;
export const SETTLE_MS = 460;
const LIKE_CONFIRM_MS = 1400;
const DISLIKE_ADVANCE_MS = 800;
const WHEEL_MIN_DELTA = 40;
const WHEEL_GAP_MS = 1100;
const CLICK_GUARD_MS = 60;
/** When the player never reports a state (autoplay refused), it is shown anyway after this long. */
export const PLAYER_SHOW_FALLBACK_MS = 2500;
const PERCENT = 100;

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

export function WatchFeed(p: WatchFeedProps): JSX.Element {
  const init = p.initial ?? {};
  const n = p.videos.length;
  const [idx, setIdx] = useState(init.idx ?? 0);
  const [mode, setMode] = useState<'feed' | 'imm'>(init.mode ?? 'feed');
  const [drag, setDrag] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [settling, setSettling] = useState(false);
  const [phase, setPhase] = useState<'thumb' | 'player'>(init.phase ?? 'thumb');
  const [muted, setMuted] = useState(init.muted ?? true);
  const [time, setTime] = useState<{ id: string; s: number; d: number } | null>(null);
  const [sheet, setSheet] = useState(init.sheet ?? false);
  const [reacts, setReacts] = useState<Reaction[]>(init.reacts ?? []);
  const [reacting, setReacting] = useState<'like' | 'dislike' | null>(init.reacting ?? null);
  const [failed, setFailed] = useState(false);
  const timers = useRef<number[]>([]);
  const st = useRef({ idx, settling, mode, reacts, reacting, phase });
  st.current = { idx, settling, mode, reacts, reacting, phase };
  const gesture = useRef<{ y0: number; down: boolean; drag: boolean; at: number }>({
    y0: 0,
    down: false,
    drag: false,
    at: 0,
  });
  const wheelAt = useRef(0);
  // the video the player last reported as shown (it may arrive while the cards are still moving)
  const shownId = useRef<string | null>(null);

  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);
  useEffect(() => {
    const t = timers.current;
    return () => t.forEach((x) => window.clearTimeout(x));
  }, []);

  const cur = p.videos[Math.min(idx, n - 1)];
  const curId = cur?.videoId ?? '';

  // the player may never report (autoplay refused): it is shown anyway, the YouTube play button then shows
  useEffect(() => {
    if (p.loading || settling || phase === 'player' || !curId) return undefined;
    const t = window.setTimeout(() => setPhase('player'), PLAYER_SHOW_FALLBACK_MS);
    return () => window.clearTimeout(t);
  }, [p.loading, settling, phase, curId, idx]);

  const advance = useCallback(
    (kind: Reaction) => {
      const s = st.current;
      if (s.settling || p.loading || s.idx >= n) return;
      const nextReacts = s.reacts.slice();
      if (kind === 'skip') {
        // swiped up: 넘김 only for a card without a verdict (좋아 then swipe stays 좋아)
        if (!nextReacts[s.idx]) {
          nextReacts[s.idx] = 'skip';
          p.onVerdict(s.idx, 'pass');
        }
      } else {
        nextReacts[s.idx] = kind;
      }
      const next = s.idx + 1;
      setReacts(nextReacts);
      setIdx(next);
      setDrag(0);
      setDragging(false);
      setSettling(true);
      setPhase('thumb');
      setSheet(false);
      setReacting(null);
      setFailed(false);
      later(() => {
        setSettling(false);
        if (next >= n) p.onFinish();
        else if (shownId.current && shownId.current === p.videos[next]?.videoId) setPhase('player');
      }, SETTLE_MS);
    },
    [n, p, later]
  );

  const react = (kind: 'like' | 'dislike'): void => {
    const s = st.current;
    if (s.settling || s.reacting || s.reacts[s.idx]) return;
    const r = s.reacts.slice();
    r[s.idx] = kind;
    setReacts(r);
    setReacting(kind);
    p.onVerdict(s.idx, VERDICT_OF[kind]);
    if (kind === 'like') later(() => setReacting(null), LIKE_CONFIRM_MS);
    else later(() => advance('dislike'), DISLIKE_ADVANCE_MS);
  };

  // keyboard (desktop): ↓ = next
  useEffect(() => {
    const kd = (e: KeyboardEvent): void => {
      if (e.key !== 'ArrowDown') return;
      e.preventDefault();
      advance('skip');
    };
    window.addEventListener('keydown', kd);
    return () => window.removeEventListener('keydown', kd);
  }, [advance]);

  const onPointerDown = (e: ReactPointerEvent): void => {
    if (st.current.settling || p.loading) return;
    gesture.current = { ...gesture.current, y0: e.clientY, down: true, drag: false };
  };
  const onPointerMove = (e: ReactPointerEvent): void => {
    const g = gesture.current;
    if (!g.down) return;
    const dy = e.clientY - g.y0;
    if (!g.drag && Math.abs(dy) < DRAG_START_PX) return;
    g.drag = true;
    setDragging(true);
    setDrag(dy < 0 ? dy : dy * DOWN_FOLLOW);
  };
  const onPointerUp = (e: ReactPointerEvent): void => {
    const g = gesture.current;
    if (!g.down) return;
    g.down = false;
    if (!g.drag) return;
    g.at = Date.now();
    const dy = e.clientY - g.y0;
    if (dy < -SWIPE_THRESHOLD_PX) advance('skip');
    else {
      setDrag(0);
      setDragging(false);
    }
  };
  const onWheel = (e: ReactWheelEvent): void => {
    const now = Date.now();
    if (e.deltaY < WHEEL_MIN_DELTA || now - wheelAt.current < WHEEL_GAP_MS) return;
    wheelAt.current = now;
    advance('skip');
  };
  /** A drag that just ended is not also a tap. */
  const tap = (fn: () => void) => (): void => {
    if (gesture.current.drag && Date.now() - gesture.current.at < CLICK_GUARD_MS) return;
    fn();
  };

  // ── player events ──
  const playerApi: R3PlayerApi = {
    videoId: curId,
    active: !settling && !p.loading && idx < n,
    play: phase === 'player' && !settling && !p.loading && idx < n,
    onShown: (id) => {
      shownId.current = id;
      if (id === curId && !st.current.settling) setPhase('player');
    },
    onMuted: (m) => {
      setMuted(m);
      // README §3: the sound turning on (the button, or YouTube's own control) = immersive playback
      if (!m && st.current.mode === 'feed') {
        setMode('imm');
        setSheet(false);
      }
    },
    onTick: (t) => setTime({ id: t.videoId, s: t.seconds, d: t.duration }),
    onFailed: setFailed,
  };

  const tapMute = tap(() => {
    if (muted) {
      setMode('imm');
      setSheet(false);
      setMuted(false);
      p.sound.current?.soundOn();
    } else {
      setMuted(true);
      p.sound.current?.soundOff();
    }
  });

  const imm = mode === 'imm';
  const f = p.frame;
  const immH = immersiveHeight(f);
  const top = topBlockHeight(f.playerH);
  const dragFrac = init.dragFrac ?? 0;
  const moving = dragging || dragFrac > 0;

  const cards = useMemo(
    () =>
      p.videos.map((v, i) => {
        const fb = feedBlocks(f, {
          why: !!v.why,
          summary: !!v.summary,
          checks: v.checks.length > 0,
          points: v.chapters.length > 0,
        });
        const ib = immersiveBlocks(f, {
          chapters: v.chapters.length,
          why: !!v.why,
          summary: !!v.summary,
          next: i + 1 < n,
        });
        return { fb, ib, h: imm ? immH : fb.height };
      }),
    [p.videos, f, imm, immH, n]
  );
  const offs = cards.reduce<number[]>((a, c) => (a.push(a[a.length - 1] + c.h), a), [0]);
  const curH = cards[Math.min(idx, n - 1)]?.h ?? 0;
  const dy = dragFrac > 0 ? -dragFrac * curH : drag;
  const stackY = Math.round(-offs[Math.min(idx, n)] + dy);
  const showPlayer = phase === 'player' && !settling && !p.loading && idx < n;
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
    <div className="mf-w3-root" data-mode={mode} data-testid="mf-w3-watch" style={rootStyle}>
      <div className="mf-w3-watch">
        <div className="mf-w3-head">
          <div className="mf-w3-head-row">
            <button
              type="button"
              className="mf-w3-icon-btn"
              data-testid="mf-watch-back"
              aria-label={imm ? '닫기' : '뒤로'}
              onClick={tap(() => {
                if (imm) {
                  setMode('feed');
                  setSheet(false);
                } else p.onBack();
              })}
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
                {counterText(Math.min(idx, n - 1), n)}
              </div>
            ) : null}
          </div>
          {n > 0 ? (
            <div className="mf-w3-segs">
              {segmentStates(n, idx).map((s, i) => (
                <div key={i} className="mf-w3-seg" data-state={s} data-testid="mf-watch-seg" />
              ))}
            </div>
          ) : null}
        </div>

        <div
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
              const nx = p.videos[i + 1];
              const slotPlayer = isCur && showPlayer;
              const secs = time && time.id === v.videoId ? time.s : 0;
              const dur =
                time && time.id === v.videoId && time.d > 0 ? time.d : (v.durationSec ?? 0);
              const prog = dur > 0 ? Math.min(PERCENT, (secs / dur) * PERCENT) : 0;
              const lowHidden = imm && (i < idx || (isCur && moving));
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
                    <div className="mf-w3-ch-meta">
                      {channelMetaText(v.durationSec, v.publishedAt)}
                    </div>
                    {slotPlayer ? (
                      <button
                        type="button"
                        className="mf-w3-mute"
                        data-muted={muted ? '' : undefined}
                        data-testid="mf-w3-mute"
                        aria-label="음소거"
                        onClick={tapMute}
                      >
                        <span className="mf-w3-mute-face">
                          <Svg size={18} vb="0 0 24 24">
                            <path d="M11 5L6 9H3v6h3l5 4z" />
                            <path
                              d={
                                muted
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
                    {isCur && phase === 'thumb' ? <div className="mf-w3-line-run" /> : null}
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

                  {!imm ? (
                    <div className="mf-w3-info">
                      {fb.showWhy ? (
                        <div className="mf-w3-why" data-testid="mf-reason">
                          <div className="mf-w3-why-k">이 영상을 고른 이유</div>
                          <div className="mf-w3-why-t">{v.why}</div>
                          {fb.showChecks ? (
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
                        {fb.showSummary ? (
                          <div className="mf-w3-sum" data-testid="mf-oneliner">
                            <div className="mf-w3-label">한 줄 요약</div>
                            <div className="mf-w3-sum-t">{v.summary}</div>
                          </div>
                        ) : null}
                        {fb.showPoints ? (
                          <div className="mf-w3-pts" data-testid="mf-chapters">
                            <div className="mf-w3-label">영상 설명란에서 추린 순서</div>
                            {v.chapters.slice(0, 2).map((c, k) => (
                              <div key={k} className="mf-w3-pt">
                                <span className="mf-w3-pt-at">{chapterStamp(c.at)}</span>
                                <span>{c.title}</span>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <div className="mf-w3-info">
                      <div className="mf-w3-imm-title" data-testid="mf-watch-title">
                        {v.title}
                      </div>
                      <div className="mf-w3-prog">
                        <div className="mf-w3-prog-track">
                          <div className="mf-w3-prog-fill" style={{ width: prog + '%' }} />
                        </div>
                        <div className="mf-w3-prog-time">
                          <span>{clockText(secs)}</span>
                          <span>{clockText(dur)}</span>
                        </div>
                      </div>
                      {ib.chapterRows > 0 ? (
                        <div className="mf-w3-chaps" data-testid="mf-chapters">
                          <div className="mf-w3-label">영상 설명란에서 추린 순서</div>
                          {v.chapters.slice(0, ib.chapterRows).map((c, k) => (
                            <div key={k} className="mf-w3-chap">
                              <span className="mf-w3-chap-at">{chapterStamp(c.at)}</span>
                              <span>{c.title}</span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                      {ib.showWhy ? (
                        <div className="mf-w3-imm-why" data-testid="mf-reason">
                          <div className="mf-w3-why-k">이 영상을 고른 이유</div>
                          <div className="mf-w3-why-t">{v.why}</div>
                        </div>
                      ) : null}
                      {ib.showSummary ? (
                        <div className="mf-w3-imm-sum" data-testid="mf-oneliner">
                          <div className="mf-w3-label">한 줄 요약</div>
                          <div className="mf-w3-sum-t">{v.summary}</div>
                        </div>
                      ) : null}
                    </div>
                  )}

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
                    {rx ? (
                      <div className="mf-w3-confirm" data-kind={rx} data-testid="mf-w3-confirm">
                        <Svg size={14} sw={2.6}>
                          <path d="M4 10.5l4 4 8-9" />
                        </Svg>
                        {rx === 'like' ? '좋아' : '별로'}
                      </div>
                    ) : null}
                    <div className="mf-w3-grow" />
                    {v.why || v.summary || v.chapters.length > 0 ? (
                      <button
                        type="button"
                        className="mf-w3-more"
                        data-testid="mf-w3-more"
                        onClick={tap(() => isCur && setSheet(true))}
                      >
                        더 보기
                        <Svg size={16}>
                          <path d="M8 4l6 6-6 6" />
                        </Svg>
                      </button>
                    ) : null}
                  </div>
                  {!imm ? <div className="mf-w3-gap" /> : null}
                  {imm && ib.nextBig && nx ? (
                    <div
                      className="mf-w3-next mf-w3-next-big"
                      data-hidden={lowHidden ? '' : undefined}
                      data-testid="mf-w3-next"
                    >
                      <div
                        className="mf-w3-next-thumb"
                        style={
                          {
                            '--w3-next-bg': nx.slotBg ?? ambientOrDefault(nx.ambient),
                          } as CSSProperties
                        }
                      >
                        {nx.thumbUrl ? <img src={nx.thumbUrl} alt="" draggable={false} /> : null}
                      </div>
                      <div className="mf-w3-next-body">
                        <div className="mf-w3-next-ch">{nx.channel}</div>
                        <div className="mf-w3-next-t">{nx.title}</div>
                      </div>
                      <UpArrow />
                    </div>
                  ) : null}
                  {imm && !ib.nextBig ? (
                    <div
                      className="mf-w3-next mf-w3-next-line"
                      data-hidden={lowHidden ? '' : undefined}
                      data-testid="mf-w3-next"
                    >
                      <UpArrow />
                      {nx ? (
                        <>
                          <div className="mf-w3-next-av">{nx.initial}</div>
                          <div className="mf-w3-next-text">
                            {[nx.channel, nx.title].filter((x) => x).join(' · ')}
                          </div>
                        </>
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
            data-shown={showPlayer ? '' : undefined}
            data-anim={dragging ? undefined : ''}
            data-testid="mf-watch-player"
            style={{
              height: f.playerH + 'px',
              transform: 'translateY(' + (showPlayer ? Math.round(dy) : 0) + 'px)',
            }}
          >
            {curId ? p.renderPlayer(playerApi) : null}
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
        <div
          className="mf-w3-sheet"
          data-testid="mf-w3-sheet"
          style={{ top: f.safeTop + HEADER_H + top + 'px' }}
        >
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
