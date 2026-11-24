import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type WheelEvent,
} from 'react';
import { toast } from 'sonner';

import {
  detectInAppBrowser,
  EXTERNAL_OPEN_CHECK_MS,
  externalOpenUrl,
  IN_APP_NOTICE,
  IN_APP_NOTICE_MS,
  markLandingSignIn,
  recordLandingEvent,
  type InAppBrowser,
  type SceneValue,
} from '@/features/landing-intro';
import { fetchLandingWall } from '@/features/morning-cards/api';
import { useViewportFitCover } from '@/features/morning-feed/use-watch-frame';
import { ensureHomeFonts } from '@/features/morning-feed/watch-home-fonts';

import {
  ADD_LABEL,
  BRAND,
  BRIEF_KICKER,
  domainsLead,
  DOT_LABEL,
  FINAL_LINE,
  LOGIN_LABEL,
  PRIVACY,
  S0_BODY,
  S0_TITLE,
  S1_TEXT,
  S2_BODY,
  S2_TITLE,
  S3_TEXT,
  S4_TEXT,
  S5_TEXT,
  S7_BODY,
  S7_LEAD,
  S7_TITLE,
  STAGE_LABEL,
  SWIPE_HINT,
  TERMS,
  wallDomains,
  YT_CREDIT,
  YT_ICON_ALT,
  ytLinkLabel,
} from '../model/landing-content';
import { heroVideo, heroWatchUrl, LANDING_EXAMPLE, sourceLabel } from '../model/landing-example';
import {
  BAND_H,
  buildScene,
  CN_H,
  DECK_ARRIVE_MS,
  DECK_CYCLE_MS,
  DECK_LEAVE_MS,
  DECK_THUMB_H,
  DOTGO,
  EASE_BACK,
  fitStage,
  FIRST_SCENE,
  LAST_SCENE,
  MOUNT_PH_MS,
  nextScene,
  PH1_MS,
  PH1_MS_S2,
  PH2_MS,
  PH2_MS_S2,
  PULL_EDGE,
  PULL_MAX_PX,
  PULL_MID,
  sceneEventValue,
  SOURCE_OPEN_SCENE,
  SOURCE_SCENE,
  STAGE_H,
  STAGE_W,
  STEP_LOCK_MS,
  SWIPE_MIN_PX,
  wallTiles,
  WHEEL_MIN,
  YT_ICON_BOX_H,
  YT_ICON_BOX_W,
  type Phase,
  type Scene,
} from '../model/landing-scene';
import ytIconSrc from '../assets/yt_icon_red_digital.png';
import { GoogleButton } from './GoogleButton';
import { LegalSheet } from './LegalSheet';
import './landing.css';

/*
 * Landing v4 for a signed-out visitor of /morning-cards?view=watch ("Insighta Intro v4.dc.html",
 * 2026-11-24): one video followed through 7 scenes (6 dots). One swipe = one scene (pointer, wheel,
 * keys; 700 ms lock), rubber band at the ends, no native scroll. The 390x650 design stage is
 * scaled to fit the screen (never larger than the visible height allows) and stretched in height:
 * top-anchored parts keep their design positions, bottom-anchored ones stay at the bottom.
 * The Google buttons, the header link and ADD start Google sign-in; the caller sets the return.
 */

/** A click this soon after a swipe ended belongs to the swipe (the finger lifted on a button). */
const SWIPE_CLICK_MS = 350;
/** design: the Google buttons are dimmed this long after a tap (busy guard). */
const BUSY_MS = 1400;
const KEYS_NEXT: readonly string[] = ['ArrowDown', 'PageDown', ' '];
const KEYS_PREV: readonly string[] = ['ArrowUp', 'PageUp'];
/** design: dark-scene background, as a token (the stage's own background colour). */
const STAGE_BG_LIGHT = 'var(--lv-paper)';
const STAGE_BG_DARK = 'var(--lv-night)';
const WALL_LINE2 = ['var(--lv-wall-line2-0)', 'var(--lv-wall-line2-1)', 'var(--lv-wall-line2-2)'];

type From = 'header' | 'sticky' | 'final' | 'add';

export interface IntroPageProps {
  /** Starts Google sign-in; the return target is set by the caller. */
  onSignIn: () => Promise<void>;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  );
}

function leaveInApp(app: InAppBrowser): void {
  const ua = navigator.userAgent;
  const notice = (): void => {
    toast(IN_APP_NOTICE, { duration: IN_APP_NOTICE_MS });
  };
  const url = externalOpenUrl(app, ua, window.location.href);
  if (!url) {
    notice();
    return;
  }
  window.location.href = url;
  // still here: the app did not hand the page over
  window.setTimeout(() => {
    if (document.visibilityState === 'visible') notice();
  }, EXTERNAL_OPEN_CHECK_MS);
}

function viewport(): { vw: number; vh: number } {
  if (typeof window === 'undefined') return { vw: STAGE_W, vh: STAGE_H };
  return { vw: window.innerWidth || STAGE_W, vh: window.innerHeight || STAGE_H };
}

const WALL_TILES = wallTiles();

export function IntroPage({ onSignIn }: IntroPageProps): JSX.Element {
  useViewportFitCover();
  const [reduced] = useState(prefersReducedMotion);
  const live = !reduced;
  const [s, setS] = useState<Scene>(FIRST_SCENE);
  const [ph, setPh] = useState<Phase>(0);
  const [di, setDi] = useState(0);
  const [deckLv, setDeckLv] = useState(-1);
  const [deckAr, setDeckAr] = useState(-1);
  const [vp, setVp] = useState(viewport);
  const [busy, setBusy] = useState(false);
  /** The shown domains from the wall answer; [] while it loads and when it fails (no list then). */
  const [domains, setDomains] = useState<string[]>([]);

  const sRef = useRef<Scene>(FIRST_SCENE);
  const diRef = useRef(0);
  const stageRef = useRef<HTMLDivElement>(null);
  const pullRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  /** The brief card's laid-out height (its transform not included). */
  const [cardH, setCardH] = useState(0);
  const t1 = useRef<number | undefined>(undefined);
  const t2 = useRef<number | undefined>(undefined);
  const lock = useRef(0);
  const y0 = useRef<number | null>(null);
  /** When the last swipe ended: the click it produces (on a button under the finger) is not a tap. */
  const swipedAt = useRef(-Infinity);
  const busyRef = useRef(false);
  const busyTimer = useRef<number | undefined>(undefined);

  sRef.current = s;
  diRef.current = di;

  useLayoutEffect(() => {
    const onResize = (): void => setVp(viewport());
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    recordLandingEvent('landing_open');
    ensureHomeFonts();
    stageRef.current?.focus({ preventScroll: true });
  }, []);

  // the last sheet's domain list is the server's (wall `cells`, hidden cells left out)
  useEffect(() => {
    let alive = true;
    const abort = typeof AbortController === 'undefined' ? undefined : new AbortController();
    fetchLandingWall(abort?.signal).then(
      (data) => {
        if (alive) setDomains(wallDomains(data));
      },
      () => undefined
    );
    return () => {
      alive = false;
      abort?.abort();
    };
  }, []);

  // measured again per scene: the fonts may have arrived since
  useLayoutEffect(() => setCardH(cardRef.current?.offsetHeight ?? 0), [s, vp]);

  // a dot reached (once per dot per visit)
  useEffect(() => {
    recordLandingEvent('landing_scene', sceneEventValue(s) as SceneValue);
  }, [s]);

  // design componentDidMount: phase 2 after 300 ms; the deck rotation in scene 1 (not reduced)
  useEffect(() => {
    const timers: number[] = [];
    timers.push(
      window.setTimeout(() => {
        if (sRef.current === 0) setPh(2);
      }, MOUNT_PH_MS)
    );
    let cyc: number | undefined;
    if (!reduced) {
      cyc = window.setInterval(() => {
        if (sRef.current !== 0) return;
        const d = diRef.current;
        setDeckLv(d);
        setDeckAr(-1);
        timers.push(
          window.setTimeout(() => {
            setDi((d + 1) % 2);
            setDeckLv(-1);
            setDeckAr(d);
            timers.push(window.setTimeout(() => setDeckAr(-1), DECK_ARRIVE_MS));
          }, DECK_LEAVE_MS)
        );
      }, DECK_CYCLE_MS);
    }
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      window.clearInterval(cyc);
      window.clearTimeout(t1.current);
      window.clearTimeout(t2.current);
      window.clearTimeout(busyTimer.current);
    };
  }, [reduced]);

  const go = useCallback(
    (target: number) => {
      const n = Math.max(FIRST_SCENE, Math.min(LAST_SCENE, target)) as Scene;
      if (n === sRef.current) return;
      window.clearTimeout(t1.current);
      window.clearTimeout(t2.current);
      sRef.current = n;
      if (reduced) {
        setS(n);
        setPh(2);
        return;
      }
      const a = n === 2 ? PH1_MS_S2 : PH1_MS;
      const b = n === 2 ? PH2_MS_S2 : PH2_MS;
      setS(n);
      setPh(0);
      t1.current = window.setTimeout(() => setPh(1), a);
      t2.current = window.setTimeout(() => setPh(2), b);
    },
    [reduced]
  );

  const step = useCallback(
    (d: 1 | -1) => {
      const now = Date.now();
      if (now - lock.current < STEP_LOCK_MS) return;
      lock.current = now;
      const n = nextScene(sRef.current, d);
      if (n !== null) go(n);
    },
    [go]
  );

  const pull = (dy: number | null): void => {
    const el = pullRef.current;
    if (!el || reduced) return;
    if (dy === null) {
      el.style.transition = EASE_BACK;
      el.style.transform = 'none';
      return;
    }
    const edge =
      (dy > 0 && sRef.current === FIRST_SCENE) || (dy < 0 && sRef.current === LAST_SCENE);
    const v = Math.max(-PULL_MAX_PX, Math.min(PULL_MAX_PX, dy * (edge ? PULL_EDGE : PULL_MID)));
    el.style.transition = 'none';
    el.style.transform = `translateY(${v}px)`;
  };

  /**
   * The event happened on the stage itself: the legal sheet is a portal, so its events reach these
   * handlers through the React tree although it is outside the stage (scrolling it must not swipe).
   */
  const inStage = (e: { currentTarget: EventTarget; target: EventTarget }): boolean =>
    (e.currentTarget as Node).contains(e.target as Node);

  const onPointerDown = (e: PointerEvent): void => {
    if (!inStage(e)) return;
    y0.current = e.clientY;
  };
  const onPointerMove = (e: PointerEvent): void => {
    if (y0.current !== null) pull(e.clientY - y0.current);
  };
  const onPointerUp = (e: PointerEvent): void => {
    if (y0.current === null) return;
    const dy = e.clientY - y0.current;
    y0.current = null;
    pull(null);
    if (Math.abs(dy) > SWIPE_MIN_PX) {
      swipedAt.current = Date.now();
      step(dy < 0 ? 1 : -1);
    }
  };
  const onWheel = (e: WheelEvent): void => {
    if (!inStage(e)) return;
    if (Math.abs(e.deltaY) > WHEEL_MIN) step(e.deltaY > 0 ? 1 : -1);
  };
  const onKeyDown = (e: KeyboardEvent): void => {
    if (!inStage(e)) return;
    const t = e.target as HTMLElement;
    // keys on a focused button keep their own meaning (Space presses it)
    if (t !== e.currentTarget && (t.tagName === 'BUTTON' || t.tagName === 'A')) {
      if (e.key === ' ') return;
    }
    if (KEYS_NEXT.includes(e.key)) {
      e.preventDefault();
      step(1);
    }
    if (KEYS_PREV.includes(e.key)) {
      e.preventDefault();
      step(-1);
    }
  };
  /** A tap, not the end of a swipe. */
  const tapped = (): boolean => Date.now() - swipedAt.current > SWIPE_CLICK_MS;

  const start = (from: From): void => {
    if (!tapped()) return;
    if (busyRef.current) return; // a second tap while leaving for Google: no second sign-in, no extra event
    busyRef.current = true;
    if (from === 'add') recordLandingEvent('add_click');
    else recordLandingEvent('start_click', from);
    setBusy(true);
    window.clearTimeout(busyTimer.current);
    busyTimer.current = window.setTimeout(() => {
      busyRef.current = false;
      setBusy(false);
    }, BUSY_MS);
    const app = detectInAppBrowser(navigator.userAgent);
    if (app) {
      leaveInApp(app);
      return;
    }
    markLandingSignIn(from === 'add' ? 'add' : 'google');
    void onSignIn().catch(() => undefined);
  };

  const onSource = (e: { stopPropagation: () => void }): void => {
    e.stopPropagation();
    if (!tapped() || sRef.current !== SOURCE_SCENE) return;
    recordLandingEvent('source_click');
    go(SOURCE_OPEN_SCENE);
  };

  const view = useMemo(
    () => buildScene(s, ph, live, { lv: deckLv, ar: deckAr }, di, LANDING_EXAMPLE, cardH),
    [s, ph, live, deckLv, deckAr, di, cardH]
  );
  const ex = LANDING_EXAMPLE;
  const hero = heroVideo(ex);
  const [heroSource, ...restSources] = ex.brief.sources;
  const fit = fitStage(vp.vw, vp.vh);
  const colLeft = (fit.w - STAGE_W) / 2;
  const colStyle = { left: colLeft + 'px', '--lv-bleed': colLeft + 'px' } as CSSProperties;
  const T = view.T;
  const off = (o: number): true | undefined => (o ? undefined : true);
  const sheetOn = view.sheetOn;
  const tab = (on: boolean): number | undefined => (on ? undefined : -1);

  return (
    <div className="lv" data-testid="lv-intro">
      <div
        ref={stageRef}
        className="lv-stage"
        data-testid="lv-stage"
        data-scene={s}
        data-phase={ph}
        data-motion={live ? '' : undefined}
        tabIndex={0}
        role="region"
        aria-roledescription="carousel"
        aria-label={STAGE_LABEL}
        style={{
          width: fit.w + 'px',
          height: fit.h + 'px',
          transform: `scale(${fit.k})`,
          backgroundColor: view.nv ? STAGE_BG_DARK : STAGE_BG_LIGHT,
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerUp}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
      >
        {/* background: light/dark fade, two glows, noise */}
        <div className="lv-fill lv-none" style={{ overflow: 'hidden' }}>
          <div
            className="lv-fill lv-bg-light"
            style={{ opacity: view.lt, transition: view.bgtr3 }}
          />
          <div
            className="lv-fill lv-bg-dark"
            style={{ opacity: view.dk, transition: view.bgtr3 }}
          />
          <div className="lv-col" style={colStyle}>
            <div
              className="lv-glow"
              style={{
                width: 520,
                height: 520,
                margin: '-260px 0 0 -260px',
                background: `radial-gradient(closest-side,${view.g1c},var(--lv-glow1-end))`,
                transform: view.g1,
                transition: view.gtr,
              }}
            />
            <div
              className="lv-glow"
              style={{
                width: 560,
                height: 560,
                margin: '-280px 0 0 -280px',
                background: `radial-gradient(closest-side,${view.g2c},var(--lv-glow2-end))`,
                transform: view.g2,
                transition: view.gtr,
              }}
            />
          </div>
          <div
            className="lv-noise"
            style={{ opacity: view.gr, transition: view.grtr, mixBlendMode: view.grb }}
          />
        </div>

        <div ref={pullRef} className="lv-fill">
          <div className="lv-col" style={colStyle}>
            {/* scene 1 blobs */}
            <div
              className="lv-blobs"
              aria-hidden="true"
              data-move={live ? '' : undefined}
              style={{ opacity: s === 0 ? 1 : 0 }}
            >
              <div className="lv-blob" data-b="a" />
              <div className="lv-blob" data-b="b" />
              <div className="lv-blob" data-b="c" />
            </div>

            {/* scenes 2-3: the drawn feed wall */}
            <div
              className="lv-wall"
              aria-hidden="true"
              data-testid="lv-wall"
              style={{ opacity: view.wall.o, transition: view.wall.tr }}
            >
              <div className="lv-wall-tilt">
                <div className="lv-wall-strip" data-move={view.wall.anim ? '' : undefined}>
                  {WALL_TILES.map((t) => (
                    <div
                      key={t.key}
                      className="lv-wall-tile"
                      style={{
                        left: t.left,
                        top: t.top,
                        backgroundColor: `var(--lv-wall-${t.color})`,
                      }}
                    >
                      <div className="lv-wall-l1" style={{ width: t.w1 }} />
                      <div
                        className="lv-wall-l2"
                        style={{ width: t.w2, background: WALL_LINE2[t.a2] }}
                      />
                      <div
                        className="lv-wall-disc"
                        style={{ right: t.r, width: t.size, height: t.size }}
                      />
                      <div className="lv-wall-time" />
                    </div>
                  ))}
                </div>
              </div>
              <div className="lv-wall-fog" />
            </div>

            {/* scenes 2 and 5 (after the tap): the hero card under the thumbnail (bar row, channel row) */}
            <div
              className="lv-band"
              data-testid="lv-band"
              aria-hidden={off(view.band.o)}
              style={{
                top: view.band.t,
                height: BAND_H + 'px',
                opacity: view.band.o,
                transition: view.band.tr,
              }}
            >
              <span className="lv-band-av">{hero.channel.slice(0, 1)}</span>
              {hero.channel}
            </div>

            {/* scene 1 */}
            <div
              className="lv-t0"
              aria-hidden={off(T[0]!.o)}
              data-testid="lv-text-0"
              style={{ opacity: T[0]!.o, transform: T[0]!.t, transition: T[0]!.tr }}
            >
              <h1 className="lv-h1">
                {S0_TITLE[0]}
                <br />
                {S0_TITLE[1]}
                <br />
                {S0_TITLE[2]}
              </h1>
              <p className="lv-t0-p">{S0_BODY}</p>
            </div>
            <button
              type="button"
              className="lv-hint"
              aria-hidden={off(T[0]!.o)}
              tabIndex={tab(s === 0)}
              style={{
                opacity: T[0]!.o,
                transition: T[0]!.tr3,
                pointerEvents: s === 0 ? undefined : 'none',
              }}
              onClick={() => {
                if (tapped()) go(1);
              }}
            >
              <svg width="18" height="10" viewBox="0 0 18 10" fill="none" aria-hidden="true">
                <path
                  className="lv-hint-arrow"
                  d="M2 8.5l7-6.5 7 6.5"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span>{SWIPE_HINT}</span>
            </button>

            <div
              className="lv-deck-wrap"
              aria-hidden={off(T[0]!.o)}
              data-testid="lv-deck"
              style={{ opacity: T[0]!.o, transform: T[0]!.t, transition: T[0]!.tr2 }}
            >
              {view.deck.map((d, i) => (
                <div
                  key={i}
                  className="lv-deck"
                  data-testid="lv-deck-card"
                  style={{ zIndex: d.z, transform: d.t, opacity: d.o, transition: d.tr }}
                >
                  <div className="lv-kicker" style={{ transition: d.tto }}>
                    {/* the blank card at the back of the deck has no text */}
                    {d.dom ? (
                      <>
                        <span className="lv-kicker-em">{BRIEF_KICKER}</span> · {d.dom}
                      </>
                    ) : null}
                  </div>
                  <div className="lv-deck-h" style={{ transition: d.tto }}>
                    {d.h}
                  </div>
                  {d.thumbs.length ? (
                    <div className="lv-deck-thumbs" style={{ opacity: d.thumbsOn ? 1 : 0 }}>
                      {d.thumbs.map((u) => (
                        <img
                          key={u}
                          className="lv-deck-thumb"
                          data-testid="lv-thumb"
                          src={u}
                          alt=""
                          decoding="async"
                        />
                      ))}
                      {d.yt ? (
                        <YouTubeIconLink
                          href={d.yt}
                          label={ytLinkLabel(hero.channel)}
                          live={s === 0 && d.thumbsOn}
                          tapped={tapped}
                          testId="lv-yt-deck"
                          // the clear space may overhang the row; the thumbnails stay where they were
                          bleedY={(YT_ICON_BOX_H - DECK_THUMB_H) / 2}
                        />
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>

            {/* scene 2 */}
            <div className="lv-fade-top" style={{ opacity: T[1]!.o, transition: view.bgtr3 }} />
            <p
              className="lv-t1"
              aria-hidden={off(T[1]!.o)}
              data-testid="lv-text-1"
              style={{ opacity: T[1]!.o, transform: T[1]!.t, transition: T[1]!.tr }}
            >
              {S1_TEXT}
            </p>

            {/* scene 3 */}
            <div
              className="lv-t2"
              aria-hidden={off(T[2]!.o)}
              data-testid="lv-text-2"
              style={{ opacity: T[2]!.o, transform: T[2]!.t, transition: T[2]!.tr }}
            >
              <h2 className="lv-h2a">
                {S2_TITLE[0]}
                <br />
                {S2_TITLE[1]}
              </h2>
              <p className="lv-t2-p">{S2_BODY}</p>
            </div>

            {/* scenes 4, 5 (before / after the source tap) */}
            <p
              className="lv-tn"
              aria-hidden={off(T[3]!.o)}
              data-testid="lv-text-3"
              style={{ opacity: T[3]!.o, transform: T[3]!.t, transition: T[3]!.tr }}
            >
              {S3_TEXT}
            </p>
            <p
              className="lv-tn"
              aria-hidden={off(T[4]!.o)}
              data-testid="lv-text-4"
              style={{ opacity: T[4]!.o, transform: T[4]!.t, transition: T[4]!.tr }}
            >
              {S4_TEXT}
            </p>
            <p
              className="lv-tn"
              data-big=""
              aria-hidden={off(T[5]!.o)}
              data-testid="lv-text-5"
              style={{ opacity: T[5]!.o, transform: T[5]!.t, transition: T[5]!.tr }}
            >
              {S5_TEXT}
            </p>

            {/* scene 6 */}
            <div className="lv-t6" aria-hidden={off(T[6]!.o)} data-testid="lv-text-6">
              <p
                className="lv-t6-lead"
                style={{ opacity: T[6]!.o, transform: T[6]!.t, transition: T[6]!.tr }}
              >
                {S7_LEAD}
              </p>
              <h2
                className="lv-t6-h"
                style={{ opacity: T[6]!.o, transform: T[6]!.t, transition: T[6]!.tr2 }}
              >
                {S7_TITLE}
              </h2>
              <p
                className="lv-t6-p"
                style={{ opacity: T[6]!.o, transform: T[6]!.t, transition: T[6]!.tr3 }}
              >
                {S7_BODY}
              </p>
            </div>

            {/* the brief card */}
            <div
              ref={cardRef}
              className="lv-card"
              aria-hidden={off(view.card.o)}
              data-testid="lv-card"
              style={{
                opacity: view.card.o,
                transform: view.card.t,
                transition: view.card.tr,
                pointerEvents: view.card.pe,
              }}
            >
              <div className="lv-card-k" style={{ opacity: view.card.dim }}>
                <span className="lv-kicker-em">{BRIEF_KICKER}</span>
                <span>·</span>
                <span>{ex.brief.domain}</span>
              </div>
              <div className="lv-card-h" style={{ opacity: view.card.dim }}>
                {ex.brief.headline}
              </div>
              <p className="lv-card-p">
                {ex.brief.firstSentence}{' '}
                {heroSource ? (
                  <span
                    className="lv-src"
                    role="button"
                    tabIndex={tab(s === SOURCE_SCENE)}
                    data-testid="lv-source"
                    onClick={onSource}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') onSource(e);
                    }}
                    style={{
                      textDecoration: view.card.deco,
                      backgroundColor: view.card.sbg,
                      transform: view.card.st,
                    }}
                  >
                    <span className="lv-src-hit" />
                    {sourceLabel(ex, heroSource)}
                  </span>
                ) : null}{' '}
                {restSources.length ? (
                  <span className="lv-src-rest" style={{ opacity: view.card.dim }}>
                    · {restSources.map((x) => sourceLabel(ex, x)).join(' · ')}
                  </span>
                ) : null}
              </p>
            </div>

            <div
              className="lv-cn"
              style={{
                top: view.cn.t,
                height: CN_H + 'px',
                transform: view.cn.s,
                transition: view.cn.tr,
              }}
            />

            <div
              className="lv-scan"
              style={{ opacity: view.scan.o, transform: view.scan.t, transition: view.scan.tr }}
            >
              <div className="lv-scan-line" />
            </div>

            {view.cells.map((c) => {
              const link = c.hero && s === SOURCE_OPEN_SCENE;
              const Tag = c.hero ? 'a' : 'div';
              return (
                <Tag
                  key={c.key}
                  className="lv-cell"
                  data-testid={c.hero ? 'lv-hero' : 'lv-cell'}
                  data-shown={c.o ? '' : undefined}
                  aria-hidden={link ? undefined : true}
                  {...(c.hero
                    ? {
                        href: heroWatchUrl(ex),
                        target: '_blank',
                        rel: 'noopener noreferrer',
                        tabIndex: link ? 0 : -1,
                        'aria-label': `${c.video.title} — ${c.video.channel} (YouTube)`,
                        onClick: (e: MouseEvent) => {
                          if (!link || !tapped()) e.preventDefault();
                        },
                      }
                    : {})}
                  style={{
                    zIndex: c.z,
                    overflow: c.ov,
                    left: c.l,
                    top: c.t,
                    width: c.w,
                    height: c.h,
                    borderRadius: c.rad,
                    backgroundColor: c.bg,
                    boxShadow: c.sh,
                    color: c.fg,
                    opacity: c.o,
                    transition: c.tr,
                    pointerEvents: link ? 'auto' : 'none',
                  }}
                >
                  <div
                    className="lv-surf"
                    style={{
                      boxShadow: c.ssh,
                      left: c.sl,
                      top: c.st,
                      width: c.sw,
                      height: c.sh2,
                      borderRadius: c.sr,
                      opacity: c.so,
                      transition: c.tr2,
                    }}
                  >
                    <img
                      className="lv-thumb"
                      data-testid="lv-thumb"
                      src={c.img}
                      alt=""
                      decoding="async"
                    />
                  </div>
                  <div
                    className="lv-cell-name"
                    style={{
                      left: c.nl,
                      top: c.nt,
                      height: c.nh,
                      opacity: c.no,
                      transition: c.trn,
                    }}
                  >
                    <span>{c.video.channel}</span>
                  </div>
                  <div className="lv-cell-big" style={{ opacity: c.bo, transition: c.tr3 }}>
                    <div className="lv-cell-big-ch">{c.video.channel}</div>
                    <div
                      className="lv-cell-big-t"
                      data-testid={c.hero ? 'lv-hero-title' : undefined}
                    >
                      {c.video.title}
                    </div>
                  </div>
                </Tag>
              );
            })}

            <div
              className="lv-bar"
              style={{
                left: view.bar.l,
                top: view.bar.t,
                width: view.bar.w,
                opacity: view.bar.o,
                transition: view.bar.tr,
              }}
            >
              <div className="lv-bar-track" />
              <div
                className="lv-bar-done"
                style={{ width: view.bar.dl, transition: view.bar.dtr }}
              />
              <div
                className="lv-bar-knob"
                style={{ left: view.bar.dl, transition: view.bar.dtr }}
              />
              <div
                className="lv-bar-label"
                data-testid="lv-bar-label"
                style={{ opacity: view.bar.lo, transition: view.bar.ltr }}
              >
                {ex.heroTime}
              </div>
            </div>

            {/* YouTube attribution while thumbnails are visible (the last sheet carries its own) */}
            <div
              key={'credit-' + s}
              className="lv-credit"
              data-testid="lv-credit"
              data-icon={view.credit.href ? '' : undefined}
              data-in={view.credit.in ? '' : undefined}
              aria-hidden={view.credit.on ? undefined : true}
              style={{
                top: view.credit.top + 'px',
                right: view.credit.right + 'px',
                color: view.credit.c,
                backgroundColor: view.credit.plate,
                opacity: view.credit.on ? 1 : 0,
              }}
            >
              <span>{YT_CREDIT}</span>
              {view.credit.href ? (
                <YouTubeIconLink
                  href={view.credit.href}
                  label={ytLinkLabel(hero.channel)}
                  live={view.credit.on}
                  tapped={tapped}
                  testId="lv-yt"
                />
              ) : null}
            </div>

            {/* scene 6: the last sheet */}
            <div
              className="lv-sheet"
              data-testid="lv-sheet"
              aria-hidden={off(T[7]!.o)}
              style={{
                opacity: T[7]!.o,
                transform: T[7]!.t,
                transition: T[7]!.tr,
                pointerEvents: sheetOn ? 'auto' : 'none',
              }}
            >
              {/* no answer yet (or none): no count and no chip row, never a fixed list */}
              {domains.length > 0 ? (
                <>
                  <p className="lv-sheet-lead" data-testid="lv-domains-lead">
                    {domainsLead(domains.length)}
                  </p>
                  <div className="lv-doms" data-testid="lv-doms">
                    {domains.map((d) => (
                      <span key={d} className="lv-dom" data-testid="lv-dom">
                        {d}
                      </span>
                    ))}
                    <button
                      type="button"
                      className="lv-add"
                      aria-label={ADD_LABEL}
                      data-testid="lv-add"
                      tabIndex={tab(sheetOn)}
                      onClick={() => start('add')}
                    >
                      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                        <path
                          className="lv-add-icon"
                          d="M7 1v12M1 7h12"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                        />
                      </svg>
                    </button>
                  </div>
                </>
              ) : null}
              <p className="lv-final">{FINAL_LINE}</p>
              <GoogleButton
                look="lv"
                busy={busy}
                onPress={() => start('final')}
                testId="lv-google-final"
                unreachable={!sheetOn}
              />
              <div className="lv-footer">
                <LegalSheet doc="privacy" label={PRIVACY.label}>
                  <button type="button" data-testid="lv-privacy" tabIndex={tab(sheetOn)}>
                    {PRIVACY.label}
                  </button>
                </LegalSheet>
                <span>·</span>
                <LegalSheet doc="terms" label={TERMS.label}>
                  <button type="button" data-testid="lv-terms" tabIndex={tab(sheetOn)}>
                    {TERMS.label}
                  </button>
                </LegalSheet>
                <span>·</span>
                <span data-testid="lv-sheet-credit">{YT_CREDIT}</span>
              </div>
            </div>
          </div>
        </div>

        {/* header, sticky button, dots: outside the rubber band */}
        <div className="lv-col lv-none" style={colStyle}>
          <div className="lv-head">
            <span className="lv-brand" style={{ color: view.hdr, transition: view.bgtr2 }}>
              {BRAND}
            </span>
            <button
              type="button"
              className="lv-login"
              data-testid="lv-login"
              aria-hidden={view.lgO ? undefined : true}
              tabIndex={tab(!!view.lgO)}
              style={{
                color: view.hdr,
                opacity: view.lgO,
                transition: live ? `${view.bgtr2}, opacity .3s` : 'none',
                pointerEvents: view.lgO ? 'auto' : 'none',
              }}
              onClick={() => start('header')}
            >
              {LOGIN_LABEL}
            </button>
          </div>

          <div
            className="lv-sticky"
            data-testid="lv-sticky"
            aria-hidden={view.btm.on ? undefined : true}
            style={{
              transform: view.btm.t,
              transition: view.btm.tr,
              pointerEvents: view.btm.on ? 'auto' : 'none',
            }}
          >
            <GoogleButton
              look="lv"
              busy={busy}
              onPress={() => start('sticky')}
              testId="lv-google-sticky"
              unreachable={!view.btm.on}
            />
          </div>

          <div className="lv-dots" style={{ pointerEvents: 'auto' }}>
            {view.dots.map((d, i) => (
              <button
                key={i}
                type="button"
                className="lv-dot"
                data-testid="lv-dot"
                aria-label={DOT_LABEL(i + 1)}
                aria-current={d.h === '16px' ? 'step' : undefined}
                onClick={() => go(DOTGO[i]!)}
              >
                <div
                  className="lv-dot-bar"
                  style={{ height: d.h, backgroundColor: d.c, transition: d.tr }}
                />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default IntroPage;

/**
 * The official YouTube Icon as a link to the video (YouTube API branding guidelines): the file is
 * drawn whole and unaltered (its transparent margin is the icon's clear space), at its own
 * proportions, on the row's solid colour. A swipe that ends on it does not open YouTube.
 */
function YouTubeIconLink({
  href,
  label,
  live,
  tapped,
  testId,
  bleedY = 0,
}: {
  href: string;
  label: string;
  /** Visible and reachable in the current scene. */
  live: boolean;
  tapped: () => boolean;
  testId: string;
  /** Negative vertical margin (px) so the file's transparent margin does not grow the row. */
  bleedY?: number;
}): JSX.Element {
  return (
    <a
      className="lv-yt"
      data-testid={testId}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      tabIndex={live ? 0 : -1}
      style={{ pointerEvents: live ? 'auto' : 'none', margin: `${-bleedY}px 0` }}
      onClick={(e) => {
        e.stopPropagation();
        if (!live || !tapped()) e.preventDefault();
      }}
    >
      <img
        className="lv-yt-img"
        src={ytIconSrc}
        alt={YT_ICON_ALT}
        width={YT_ICON_BOX_W}
        height={YT_ICON_BOX_H}
        decoding="async"
        draggable={false}
      />
    </a>
  );
}
