import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
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
} from '@/features/landing-intro';
import { fetchLandingWall } from '@/features/morning-cards/api';
import { useViewportFitCover } from '@/features/morning-feed/use-watch-frame';
import {
  ensureHomeFonts,
  FONT_WAIT_MS,
  waitHomeFonts,
} from '@/features/morning-feed/watch-home-fonts';

import {
  ADD_LABEL,
  BRAND,
  CAPTIONS,
  DOMAINS,
  DOMAINS_LEAD,
  FINAL_LINE,
  HERO_BODY,
  HERO_TITLE,
  ILLU,
  ILLU_CHANNELS,
  PRINCIPLE_BODY,
  PRINCIPLE_TITLE,
  PROBLEM,
  PROBLEM_ANSWER,
  PRIVACY,
  TERMS,
  thumbUrl,
  WALL_CREDIT,
  WALL_PICK,
  wallLetters,
  wallVideos,
  watchUrl,
  type WallVideo,
} from '../model/intro-content';
import { GoogleButton } from './GoogleButton';
import { LegalSheet } from './LegalSheet';
// the watch tokens (--w-*) and the .mf-w root the landing shares with the watch screens
import '@/features/morning-feed/watch.css';
import './intro.css';

/*
 * Landing page for a signed-out visitor of /morning-cards?view=watch (design "Insighta Intro",
 * 2026-11-24): hero with the channel wall, the problem, a pinned brief illustration in three
 * steps, the principle, the domains with ADD, and the last Google button. Scroll positions,
 * timings and sizes are the design's. A Google button (or ADD) starts Google sign-in; the
 * return goes to today's brief screen (the caller decides where).
 */

/** The illustration is drawn at this width and scaled to the card (design: 362/390 at 390). */
const ILLU_W = 390;
/** design: phase 1 (wall lights) and phase 2 (hero text) after the fonts. */
const PHASE1_MS = 150;
const PHASE2_MS = 1100;
/** design: the Google buttons are dimmed this long after a tap. */
const BUSY_MS = 1400;
/** design: progress through the pinned section -> step 1/2/3. */
const STEP1_FROM = -0.02;
const STEP2_FROM = 0.3;
const STEP3_FROM = 0.63;
/** design: step 3 moves the illustration so the video list sits this far from the card top. */
const LIST_TOP_GAP = 40;
/** design: the top and bottom bars turn navy this far into the pinned section. */
const DARK_EDGE = 40;
/** design: the bottom bar leaves once the last section is this far into the screen. */
const BAR_HIDE_INTO_FINAL = 200;
/** design: the top bar's line shows after this much scroll. */
const TOP_LINE_AFTER = 8;
/** design: a section fades in once this share of it is visible. */
const REVEAL_THRESHOLD = 0.18;
/** design: wall delays (s): lit tiles one after another, the rest in groups of 7. */
const PICK_DELAY_S = 0.25;
const PICK_STEP_S = 0.07;
const REST_STEP_S = 0.03;
const REST_GROUP = 7;
/** Caption faded in for this step (the others are hidden from screen readers too). */
const STEPS = [1, 2, 3] as const;

type Phase = 0 | 1 | 2;
type Step = 0 | 1 | 2 | 3;
type From = 'sticky' | 'final' | 'add';

interface ScrollView {
  step: Step;
  dark: boolean;
  bar: boolean;
  top: boolean;
  /** Step 3's shift of the illustration (px, unscaled). */
  ty: number;
}

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

const WALL = wallLetters(ILLU_CHANNELS);
const PICKS: readonly number[] = WALL_PICK;
const FONT_HEADLINES = [...HERO_TITLE, PRINCIPLE_TITLE, FINAL_LINE, ILLU.headline].join(' ');
const FONT_UI = [HERO_BODY, PROBLEM, PROBLEM_ANSWER, ...CAPTIONS, DOMAINS_LEAD, ...DOMAINS].join(
  ' '
);

export function IntroPage({ onSignIn }: IntroPageProps): JSX.Element {
  useViewportFitCover();
  const [reduced] = useState(prefersReducedMotion);
  const [phase, setPhase] = useState<Phase>(reduced ? 2 : 0);
  const [view, setView] = useState<ScrollView>({
    step: 0,
    dark: false,
    bar: true,
    top: false,
    ty: 0,
  });
  const [vh, setVh] = useState(() => (typeof window === 'undefined' ? 0 : window.innerHeight));
  const [cardW, setCardW] = useState(ILLU_W);
  const [busy, setBusy] = useState(false);
  /** The thumbnail wall once its data arrived; null = the letter tiles. */
  const [videos, setVideos] = useState<Array<WallVideo | null> | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const pin = useRef<HTMLElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const fin = useRef<HTMLElement>(null);
  const busyTimer = useRef<number | undefined>(undefined);
  const busyRef = useRef(false);
  const step3Kept = useRef(false);

  // the scroller's height is the hero's and the pinned view's; the card's width scales the drawing
  useLayoutEffect(() => {
    const measure = (): void => {
      if (scroller.current) setVh(scroller.current.clientHeight);
      if (card.current) setCardW(card.current.clientWidth);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // entrance after the fonts and the wall data (each at most FONT_WAIT_MS), as the design waits
  // for document.fonts; the wall stays the letter tiles when its data fails, is empty or is late
  // (late data still replaces the letters when it arrives)
  useEffect(() => {
    recordLandingEvent('landing_open');
    ensureHomeFonts();
    let alive = true;
    const timers: number[] = [];
    const abort = typeof AbortController === 'undefined' ? undefined : new AbortController();
    const wall = fetchLandingWall(abort?.signal).then(
      (data) => {
        if (alive) setVideos(wallVideos(data));
      },
      () => undefined
    );
    const wallDecided = Promise.race([
      wall,
      new Promise<void>((resolve) => timers.push(window.setTimeout(resolve, FONT_WAIT_MS))),
    ]);
    void Promise.all([waitHomeFonts(FONT_HEADLINES, FONT_UI), wallDecided]).then(() => {
      if (!alive || reduced) return;
      timers.push(window.setTimeout(() => setPhase(1), PHASE1_MS));
      timers.push(window.setTimeout(() => setPhase(2), PHASE2_MS));
    });
    return () => {
      alive = false;
      abort?.abort();
      timers.forEach((t) => window.clearTimeout(t));
      window.clearTimeout(busyTimer.current);
    };
  }, [reduced]);

  // sections fade in as they come into view (not with reduced motion)
  useEffect(() => {
    const root = scroller.current;
    if (reduced || !root || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(
      (es) =>
        es.forEach((e) => {
          if (!e.isIntersecting) return;
          e.target.setAttribute('data-shown', '');
          io.unobserve(e.target);
        }),
      { root, threshold: REVEAL_THRESHOLD }
    );
    root.querySelectorAll('[data-rv]').forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, [reduced]);

  const onScroll = useCallback(() => {
    const el = scroller.current;
    const p0 = pin.current;
    const f = fin.current;
    if (!el || !p0 || !f) return;
    const st = el.scrollTop;
    const h = el.clientHeight;
    const p = (st - p0.offsetTop) / (p0.offsetHeight - h);
    const step: Step =
      p < STEP1_FROM ? 0 : p < STEP2_FROM ? 1 : p < STEP3_FROM ? 2 : p <= 1 ? 3 : 0;
    const next: ScrollView = {
      step,
      dark: st + DARK_EDGE >= p0.offsetTop && st < p0.offsetTop + p0.offsetHeight - DARK_EDGE,
      bar: st + h < f.offsetTop + BAR_HIDE_INTO_FINAL,
      top: st > TOP_LINE_AFTER,
      ty: step === 3 && list.current ? -(list.current.offsetTop - LIST_TOP_GAP) : 0,
    };
    if (step === 3 && !step3Kept.current) {
      step3Kept.current = true;
      recordLandingEvent('landing_scroll_step3');
    }
    setView((v) =>
      v.step === next.step && v.dark === next.dark && v.bar === next.bar && v.top === next.top
        ? v
        : next
    );
  }, []);

  const start = (from: From): void => {
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

  const { step } = view;
  const fade = (k: Step): number => (!step || step === k ? 1 : 0.2);
  const dim = step ? 0.2 : 1;
  const scale = cardW / ILLU_W;

  return (
    <div className="mf-w li" data-testid="li-intro">
      <div
        className="li-frame"
        data-phase={phase}
        data-motion={reduced ? undefined : ''}
        data-screen-label="소개"
      >
        <div
          className="li-top"
          data-dark={view.dark ? '' : undefined}
          data-top={view.top ? '' : undefined}
        >
          <div className="li-brand">{BRAND}</div>
        </div>

        <div ref={scroller} className="li-scroll" onScroll={onScroll} data-testid="li-scroll">
          <section className="li-hero">
            <div className="li-wall" aria-hidden={videos ? undefined : true} data-testid="li-wall">
              <div className="li-wall-grid">
                {(videos ?? WALL).map((tile, i) => {
                  const k = PICKS.indexOf(i);
                  const dl =
                    k >= 0 ? PICK_DELAY_S + k * PICK_STEP_S : (i % REST_GROUP) * REST_STEP_S;
                  const style = { '--li-dl': dl + 's' } as CSSProperties;
                  const pick = k >= 0 ? '' : undefined;
                  if (tile && typeof tile === 'object') {
                    return (
                      <a
                        key={tile.id}
                        className="li-tile"
                        data-thumb=""
                        data-pick={pick}
                        data-testid="li-tile"
                        style={style}
                        href={watchUrl(tile.id)}
                        target="_blank"
                        rel="noopener"
                        aria-label={tile.label || undefined}
                      >
                        <img className="li-thumb" src={thumbUrl(tile.id)} alt="" decoding="async" />
                      </a>
                    );
                  }
                  return (
                    <div
                      key={i}
                      className="li-tile"
                      data-pick={pick}
                      data-testid="li-tile"
                      style={style}
                    >
                      {tile}
                    </div>
                  );
                })}
              </div>
            </div>
            {videos ? (
              <p className="li-wall-credit" data-testid="li-wall-credit">
                {WALL_CREDIT}
              </p>
            ) : null}
            <div className="li-hero-text">
              {/* placeholder bars while the title waits for its entrance (James 2026-11-24: an
                  empty space under the wall looked broken); they fade out as the text fades in */}
              <div className="li-skel" aria-hidden="true" data-testid="li-skel">
                <span className="li-skel-bar" data-w="title1" />
                <span className="li-skel-bar" data-w="title2" />
                <span className="li-skel-bar" data-w="p1" />
                <span className="li-skel-bar" data-w="p2" />
                <span className="li-skel-bar" data-w="p3" />
              </div>
              <h1 className="li-h1">
                {HERO_TITLE[0]}
                <br />
                {HERO_TITLE[1]}
              </h1>
              <p className="li-hero-p" data-testid="li-hero-body">
                {HERO_BODY}
              </p>
            </div>
          </section>

          <section className="li-problem" data-rv="">
            <p className="li-problem-p">{PROBLEM}</p>
            <p className="li-problem-a">{PROBLEM_ANSWER}</p>
          </section>

          <section ref={pin} className="li-pin" data-testid="li-pin">
            <div className="li-sticky" style={{ height: vh + 'px' }}>
              <div className="li-caps">
                {CAPTIONS.map((t, i) => {
                  const s = STEPS[i]!;
                  return (
                    <p
                      key={s}
                      className="li-cap"
                      data-at={step === s ? 'on' : step > s ? 'past' : undefined}
                      aria-hidden={step === s ? undefined : true}
                    >
                      {t}
                    </p>
                  );
                })}
              </div>
              <div ref={card} className="li-card">
                <div
                  className="li-illu"
                  style={{ transform: `scale(${scale}) translateY(${view.ty}px)` }}
                  data-testid="li-illu"
                >
                  <div className="li-illu-kicker li-illu-fade" style={{ opacity: dim }}>
                    {ILLU.kicker}
                  </div>
                  <div className="li-illu-h li-illu-fade" style={{ opacity: fade(1) }}>
                    {ILLU.headline}
                  </div>
                  <p className="li-illu-p li-illu-p1 li-illu-fade" style={{ opacity: fade(2) }}>
                    {ILLU.p1}{' '}
                    <span className="li-illu-cite" data-on={step === 2 ? '' : undefined}>
                      {ILLU.p1Cite}
                    </span>{' '}
                    <span className="li-illu-cite-rest">{ILLU.p1Cite2}</span>
                  </p>
                  <p className="li-illu-p li-illu-p2 li-illu-fade" style={{ opacity: dim }}>
                    {ILLU.p2} <span className="li-illu-cite-rest">{ILLU.p2Cite}</span>
                  </p>
                  <div className="li-illu-more li-illu-fade" style={{ opacity: dim }}>
                    {ILLU.more}
                  </div>
                  <div
                    ref={list}
                    className="li-illu-list li-illu-fade"
                    style={{ opacity: fade(3) }}
                  >
                    <div className="li-illu-label">{ILLU.listLabel}</div>
                    <div className="li-illu-rows">
                      {ILLU_CHANNELS.map((n) => (
                        <div key={n} className="li-illu-row">
                          <div className="li-illu-av">{n.slice(0, 1)}</div>
                          <div className="li-illu-name">{n}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="li-principle" data-rv="">
            <h2 className="li-h2">{PRINCIPLE_TITLE}</h2>
            <p className="li-principle-p">{PRINCIPLE_BODY}</p>
          </section>

          <section className="li-domains" data-rv="">
            <p className="li-domains-lead">{DOMAINS_LEAD}</p>
            <div className="li-domains-list">
              {DOMAINS.map((d) => (
                <div key={d} className="li-domain">
                  {d}
                </div>
              ))}
              <button
                type="button"
                className="li-add"
                data-testid="li-add"
                onClick={() => start('add')}
              >
                <span>{ADD_LABEL}</span>
                <svg
                  className="li-add-icon"
                  width="20"
                  height="20"
                  viewBox="0 0 20 20"
                  fill="none"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M10 3v14M3 10h14" />
                </svg>
              </button>
            </div>
          </section>

          <section ref={fin} className="li-final">
            <p className="li-final-line">{FINAL_LINE}</p>
            <GoogleButton busy={busy} onPress={() => start('final')} testId="li-google-final" />
            <div className="li-footer">
              <LegalSheet doc="privacy" label={PRIVACY.label}>
                <button type="button" data-testid="li-privacy">
                  {PRIVACY.label}
                </button>
              </LegalSheet>
              <span>·</span>
              <LegalSheet doc="terms" label={TERMS.label}>
                <button type="button" data-testid="li-terms">
                  {TERMS.label}
                </button>
              </LegalSheet>
            </div>
          </section>
        </div>

        <div
          className="li-bar"
          data-dark={view.dark ? '' : undefined}
          data-hidden={view.bar ? undefined : ''}
          aria-hidden={view.bar ? undefined : true}
        >
          <GoogleButton
            busy={busy}
            onPress={() => start('sticky')}
            testId="li-google-sticky"
            unreachable={!view.bar}
          />
        </div>
      </div>
    </div>
  );
}

export default IntroPage;
