import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
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

import { DOT_LABEL, STAGE_LABEL, wallDomains } from '../model/landing-content';
import { LANDING_EXAMPLE, withoutVideos, type PlayTarget } from '../model/landing-example';
import {
  DECK_ARRIVE_MS,
  DECK_CYCLE_MS,
  DECK_LEAVE_MS,
  buildScene,
  DOTGO,
  dotsTopAbove,
  EASE,
  fitStage,
  FIRST_SCENE,
  isDark,
  LAST_SCENE,
  MOUNT_PH_MS,
  PH1_MS,
  PH1_MS_S2,
  PH2_MS,
  PH2_MS_S2,
  sceneEventValue,
  SOURCE_OPEN_SCENE,
  SOURCE_SCENE,
  STAGE_H,
  STAGE_W,
  type DeckState,
  type Phase,
  type Scene,
} from '../model/landing-scene';
import { GoogleButton } from './GoogleButton';
import { LandingPlayer } from './LandingPlayer';
import { ScenePane } from './ScenePane';
import { useScenePager } from './use-scene-pager';
import './landing.css';

/*
 * Landing v4 for a signed-out visitor of /morning-cards?view=watch ("Insighta Intro v4.dc.html",
 * 2026-11-24): one video followed through 7 scenes (6 dots). The page follows the finger 1:1 with the
 * neighbour scene beside it (use-scene-pager.ts; wheel and keys page the same way), no native scroll. The 390x650 design stage is
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
/** A neighbour page can be neither tapped nor focused. */
const INERT = { inert: '' } as Record<string, string>;
const DECK_REST: DeckState = { lv: -1, ar: -1 };

/** A resize during a gesture is looked at again after this long. */
const RESIZE_RETRY_MS = 200;

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
  /** Videos whose thumbnail could not be loaded: another evidence video takes their place. */
  const [dead, setDead] = useState<ReadonlySet<string>>(() => new Set());
  const ex = useMemo(() => withoutVideos(LANDING_EXAMPLE, dead), [dead]);
  const onDead = useCallback(
    (id: string): void => setDead((d) => (d.has(id) ? d : new Set([...d, id]))),
    []
  );
  /** The shown domains from the wall answer; [] while it loads and when it fails (no list then). */
  const [domains, setDomains] = useState<string[]>([]);

  const sRef = useRef<Scene>(FIRST_SCENE);
  const diRef = useRef(0);
  const stageRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  /** The brief card's laid-out height (its transform not included). */
  const [cardH, setCardH] = useState(0);
  const sheetRef = useRef<HTMLDivElement>(null);
  /** The video playing over the landing, or null. A tap never leaves the landing (James 2026-11-25). */
  const [playing, setPlaying] = useState<PlayTarget | null>(null);
  /** The last sheet's laid-out height (it grows when the domain list arrives). */
  const [sheetH, setSheetH] = useState(0);
  const t1 = useRef<number | undefined>(undefined);
  const t2 = useRef<number | undefined>(undefined);
  const busyRef = useRef(false);
  const busyTimer = useRef<number | undefined>(undefined);

  sRef.current = s;
  diRef.current = di;

  // the height is not read again while a finger is on the page or a page settles: the browser bars
  // come and go during a swipe, and a new height would shake the scene
  const busyRefPager = useRef<() => boolean>(() => false);
  useLayoutEffect(() => {
    let wait: number | undefined;
    const onResize = (): void => {
      window.clearTimeout(wait);
      if (busyRefPager.current()) wait = window.setTimeout(onResize, RESIZE_RETRY_MS);
      else setVp(viewport());
    };
    onResize();
    window.addEventListener('resize', onResize);
    return () => {
      window.clearTimeout(wait);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  // no pull-to-refresh and no page scroll behind the landing while it is shown
  useEffect(() => {
    const roots = [document.documentElement, document.body];
    const before = roots.map((r) => r.style.overscrollBehavior);
    roots.forEach((r) => (r.style.overscrollBehavior = 'none'));
    const el = stageRef.current;
    const hold = (e: TouchEvent): void => {
      if (e.cancelable) e.preventDefault();
    };
    el?.addEventListener('touchmove', hold, { passive: false });
    return () => {
      roots.forEach((r, i) => (r.style.overscrollBehavior = before[i]!));
      el?.removeEventListener('touchmove', hold);
    };
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
  useLayoutEffect(() => setSheetH(sheetRef.current?.offsetHeight ?? 0), [s, vp, domains]);

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

  const fit = fitStage(vp.vw, vp.vh);
  /** A scene is current: its steps (ph) start now, the page is in place. */
  const onScene = useCallback(
    (n: Scene): void => {
      window.clearTimeout(t1.current);
      window.clearTimeout(t2.current);
      sRef.current = n;
      setS(n);
      if (reduced) {
        setPh(2);
        return;
      }
      setPh(0);
      t1.current = window.setTimeout(() => setPh(1), n === 2 ? PH1_MS_S2 : PH1_MS);
      t2.current = window.setTimeout(() => setPh(2), n === 2 ? PH2_MS_S2 : PH2_MS);
    },
    [reduced]
  );
  const onGesture = useCallback((value: string): void => {
    recordLandingEvent('landing_swipe', value);
  }, []);
  const pager = useScenePager({ scale: fit.k, reduced, onScene, onGesture });
  busyRefPager.current = pager.busy;
  const { step, go: goScene, draggedAt } = pager;
  const go = useCallback(
    (target: number): void => goScene(Math.max(FIRST_SCENE, Math.min(LAST_SCENE, target)) as Scene),
    [goScene]
  );

  /**
   * The event happened on the stage itself: the legal sheet is a portal, so its events reach these
   * handlers through the React tree although it is outside the stage (scrolling it must not swipe).
   */
  const inStage = (e: { currentTarget: EventTarget; target: EventTarget }): boolean =>
    (e.currentTarget as Node).contains(e.target as Node);

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
  const tapped = useCallback(
    (): boolean => Date.now() - (draggedAt.current ?? -Infinity) > SWIPE_CLICK_MS,
    [draggedAt]
  );

  const startRef = useRef<(from: From) => void>(() => undefined);
  startRef.current = (from: From): void => {
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
  const start = useCallback((from: From): void => startRef.current(from), []);

  const onSource = useCallback(
    (e: { stopPropagation: () => void }): void => {
      e.stopPropagation();
      if (!tapped() || sRef.current !== SOURCE_SCENE) return;
      recordLandingEvent('source_click');
      go(SOURCE_OPEN_SCENE);
    },
    [go, tapped]
  );
  const onHint = useCallback((): void => step(1), [step]);
  // a signed-in visitor never sees the landing (MorningCardsEntry): home is the first scene
  const onBrand = useCallback((): void => go(FIRST_SCENE), [go]);

  const view = useMemo(
    () => buildScene(s, ph, live, DECK_REST, 0, LANDING_EXAMPLE, cardH),
    [s, ph, live, cardH]
  );
  const deck = useMemo<DeckState>(() => ({ lv: deckLv, ar: deckAr }), [deckLv, deckAr]);
  const colLeft = (fit.w - STAGE_W) / 2;
  const colStyle = useMemo(
    () => ({ left: colLeft + 'px', '--lv-bleed': colLeft + 'px' }) as CSSProperties,
    [colLeft]
  );
  const sheetOn = view.sheetOn;
  const { prev, cur, next } = pager.panes;
  const pages = [
    ...(prev ? [{ pane: prev, at: -1 }] : []),
    { pane: cur, at: 0 },
    ...(next ? [{ pane: next, at: 1 }] : []),
  ];

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
        {...pager.handlers}
        onKeyDown={onKeyDown}
      >
        {/* the scenes: the current page and its neighbours, moved together by the finger */}
        <div ref={pager.trackRef} className="lv-fill lv-track" data-testid="lv-track">
          {pages.map(({ pane, at }) => {
            const main = at === 0;
            return (
              <div
                key={pane.id}
                className="lv-page"
                data-page={at}
                aria-hidden={main ? undefined : true}
                {...(main ? {} : INERT)}
                style={{
                  top: `${at * 100}%`,
                  backgroundColor: isDark(pane.s) ? STAGE_BG_DARK : STAGE_BG_LIGHT,
                }}
              >
                <ScenePane
                  ex={ex}
                  onDead={onDead}
                  s={pane.s}
                  ph={main ? ph : 0}
                  live={live}
                  main={main}
                  deck={main ? deck : DECK_REST}
                  di={di}
                  cardH={cardH}
                  colStyle={colStyle}
                  domains={domains}
                  busy={busy}
                  cardRef={cardRef}
                  sheetRef={sheetRef}
                  tapped={tapped}
                  onHint={onHint}
                  onBrand={onBrand}
                  onSource={onSource}
                  onStart={start}
                  onPlay={setPlaying}
                />
              </div>
            );
          })}
        </div>

        {/* sticky button, dots: they stay while the pages move (the header is each page's own) */}
        <div className="lv-col lv-none" style={colStyle}>
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

          {/* the last scene's dots are centred between the header and the sheet, not over it */}
          <div
            className="lv-dots"
            data-testid="lv-dots"
            style={{
              pointerEvents: 'auto',
              top: sheetOn && sheetH > 0 ? `${dotsTopAbove(sheetH, fit.h)}px` : undefined,
              transition: live ? `top .35s ${EASE}` : 'none',
            }}
          >
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
      {playing ? <LandingPlayer target={playing} onClose={() => setPlaying(null)} /> : null}
    </div>
  );
}

export default IntroPage;
