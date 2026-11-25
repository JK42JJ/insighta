import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';

import { ensureHomeFonts, waitHomeFonts } from '@/features/morning-feed/watch-home-fonts';
import { HomeHead } from '@/features/morning-feed/HomeHead';
import {
  headlineSize,
  HOME_BUTTON_LABEL,
  homeTint,
  nextWithPage,
  seenDateLabel,
} from '@/features/morning-feed/watch-home-model';
import type { Frame } from '@/features/morning-feed/watch-r3-layout';
import { AccountSheet, type R3AccountView } from '@/features/morning-feed/watch-r3-screens';
import { SkeletonLines } from '@/features/morning-feed/SkeletonLines';
import { useSkeleton } from '@/features/morning-feed/use-skeleton';
import './watch-home.css';

/*
 * Daily home (design handoff "design_handoff_insighta_home", HomeMotionPhone.dc.html is the
 * reference): the newest headline of the chosen domain with the button into its brief in the
 * middle, the domain chips at the bottom, the date (past briefs) and the account at the top
 * (decision 2026-11-25). Light background only (decision 2026-11-14).
 *
 * Motion (README "한 덩어리 페이드"): the headline fades as one element, opacity only. Entrance:
 * headline 0->1 450 ms ease-out, then the date, the domain name, button and chips 0->1 300 ms
 * ease-out at 450 ms. Domain switch: the chip, the domain name and the date change at once (the
 * chip's colour in 0.2 s), the headline fades out 180 ms ease-in, the text changes, it fades in
 * 450 ms ease-out while the domain name and the button slide from where they were in 300 ms cubic-bezier(.2,.8,.2,1). Taps during a switch are
 * ignored, except on the headline (below). The headline rolls to the next domain with a brief, after the last one the
 * first; a tap during a switch is kept and done after it. The ground carries the domain's colour from the bottom up,
 * changing in 1 s (design "Insighta App Prototype", 2026-11-25). Reduced motion: no motion at all. The motion waits for the fonts at most 1.5 s.
 */

export interface HomeChip {
  /** Goal cell label (the domain). */
  cell: string;
  title: string;
}

export interface HomeHeadline {
  headline: string;
  seenDate: string;
}

export interface WatchHomeProps {
  frame: Frame & { width: number };
  account?: R3AccountView;
  chips: HomeChip[];
  /** Domains with a page: their newest headline and seen date. */
  pages: Record<string, HomeHeadline>;
  /** The last watched domain (it has a page). */
  initial: string;
  /** A chip of a domain without a brief (none are shown to participants). */
  onOpen: (cell: string) => void;
  /** The button: that domain's brief. */
  onOpenPage: (cell: string) => void;
  /** The date in the head: past briefs, from the shown brief's date (absent = date text only). */
  onPast?: (cell: string, date: string) => void;
  /** A domain was chosen with its chip. */
  onShow?: (cell: string) => void;
  /** A later home of the same visit: its fonts are in, so it is drawn at once, without entrance. */
  settled?: boolean;
  /** The domain whose headline to show from now on (the one read last); changed while covered. */
  show?: string;
  /** This home is the screen on top (its headline is seen). */
  onTop?: boolean;
  /** A headline is on screen. */
  onHeadline?: (cell: string) => void;
  /** The domain was changed, with a chip or by rolling the headline. */
  onSwitch?: (from: string, to: string, how: 'chip' | 'headline') => void;
}

const FADE_IN_MS = 450;
const REST_IN_MS = 300;
const FADE_OUT_MS = 180;
const SLIDE_MS = 300;
/** The new headline waits this long when its lines changed, so the sliding name and button are off its place. */
const CLEAR_MS = 100;
const SLIDE_EASE = 'cubic-bezier(.2,.8,.2,1)';
/** Below this width the chips use 12.5 px (README §배치 5). */
const NARROW_W = 360;
const UI_TEXT = '브리프 읽기 →0123456789월일화수목금토요';

function reducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  );
}

function cellsOf(p: WatchHomeProps): string[] {
  return p.chips.map((c) => c.cell);
}

export function WatchHome(p: WatchHomeProps): JSX.Element {
  const [sel, setSel] = useState(p.initial);
  const [shown, setShown] = useState(p.initial);
  /** One more per text change, so a roll that ends where it began still fades in. */
  const [turn, setTurn] = useState(0);
  const [ready, setReady] = useState(!!p.settled);
  const [acct, setAcct] = useState(false);
  const head = useRef<HTMLHeadingElement>(null);
  const date = useRef<HTMLDivElement>(null);
  const meta = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLDivElement>(null);
  const chipsEl = useRef<HTMLDivElement>(null);
  const anims = useRef<Animation[]>([]);
  const busy = useRef(false);
  /** Headline taps that came during a switch. */
  const rolls = useRef(0);
  const entrance = useRef(false);
  const swap = useRef<{ meta: number | null; btn: number | null } | null>(null);
  const timer = useRef<number | null>(null);

  const stop = (): void => {
    anims.current.forEach((a) => a.cancel());
    anims.current = [];
  };
  const animate = (el: Element | null, kf: Keyframe[], o: KeyframeAnimationOptions): void => {
    if (el?.animate) anims.current.push(el.animate(kf, { fill: 'backwards', ...o }));
  };

  // fonts first (at most 1.5 s), then the entrance once
  const allHeadlines = Object.values(p.pages)
    .map((x) => x.headline)
    .join(' ');
  const uiText =
    UI_TEXT +
    p.chips.map((c) => c.title).join('') +
    Object.values(p.pages)
      .map((x) => seenDateLabel(x.seenDate))
      .join('');
  useEffect(() => {
    let alive = true;
    ensureHomeFonts();
    if (p.settled) return undefined;
    void waitHomeFonts(allHeadlines, uiText).then((r) => {
      if (!alive) return;
      entrance.current = r === 'ready' && !reducedMotion();
      setReady(true);
    });
    return () => {
      alive = false;
      if (timer.current != null) window.clearTimeout(timer.current);
      anims.current.forEach((a) => a.cancel());
    };
    // the texts of this visit; read once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    if (!ready || !entrance.current) return;
    entrance.current = false;
    stop();
    animate(head.current, [{ opacity: 0 }, { opacity: 1 }], {
      duration: FADE_IN_MS,
      easing: 'ease-out',
    });
    [date.current, meta.current, btn.current, chipsEl.current].forEach((el) =>
      animate(el, [{ opacity: 0 }, { opacity: 1 }], {
        duration: REST_IN_MS,
        delay: FADE_IN_MS,
        easing: 'ease-out',
      })
    );
  }, [ready]);

  // after the text changed: fade in, and slide the domain name and button from where they were
  useLayoutEffect(() => {
    const before = swap.current;
    if (!before) return;
    swap.current = null;
    stop();
    const moved = (el: HTMLElement | null, was: number | null): number =>
      el && was != null ? Math.round(was - el.getBoundingClientRect().top) : 0;
    const far = [moved(meta.current, before.meta), moved(btn.current, before.btn)];
    animate(head.current, [{ opacity: 0 }, { opacity: 1 }], {
      duration: FADE_IN_MS,
      delay: far.some((d) => d !== 0) ? CLEAR_MS : 0,
      easing: 'ease-out',
    });
    const slide = (el: HTMLElement | null, d: number): void => {
      if (d)
        animate(el, [{ transform: 'translateY(' + d + 'px)' }, { transform: 'none' }], {
          duration: SLIDE_MS,
          easing: SLIDE_EASE,
        });
    };
    slide(meta.current, far[0]!);
    slide(btn.current, far[1]!);
    busy.current = false;
  }, [shown, turn]);

  // the domain read last (order 2026-11-25 B12): set while another screen covers the home, at once
  const { show } = p;
  const shownFor = useRef(show);
  useEffect(() => {
    if (shownFor.current === show) return;
    shownFor.current = show;
    if (!show || !p.pages[show]) return;
    stop();
    if (timer.current != null) window.clearTimeout(timer.current);
    busy.current = false;
    rolls.current = 0;
    swap.current = null;
    setSel(show);
    setShown(show);
    // only when the domain to show changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);

  const seen = useRef(p.onHeadline);
  seen.current = p.onHeadline;
  const onTop = p.onTop !== false;
  useEffect(() => {
    if (ready && onTop) seen.current?.(shown);
  }, [ready, onTop, shown]);

  const pick = useCallback(
    (cell: string, how: 'chip' | 'headline' = 'chip') => {
      if (busy.current || cell === sel) return;
      if (!p.pages[cell]) {
        p.onOpen(cell);
        return;
      }
      p.onShow?.(cell);
      p.onSwitch?.(sel, cell, how);
      if (reducedMotion() || !ready) {
        stop();
        setSel(cell);
        setShown(cell);
        return;
      }
      busy.current = true;
      // from how it looks now: a headline still fading in does not flash to full first
      const now = head.current ? Number(getComputedStyle(head.current).opacity) : 1;
      head.current?.getAnimations?.().forEach((a) => a.cancel());
      animate(head.current, [{ opacity: now }, { opacity: 0 }], {
        duration: FADE_OUT_MS,
        easing: 'ease-in',
        fill: 'forwards',
      });
      setSel(cell);
      timer.current = window.setTimeout(() => {
        // where they are on the screen: the block is centred, so it moves with the line count
        swap.current = {
          meta: meta.current ? meta.current.getBoundingClientRect().top : null,
          btn: btn.current ? btn.current.getBoundingClientRect().top : null,
        };
        // taps on the headline meanwhile: the text changes once, to where they lead
        const to =
          (rolls.current > 0 && nextWithPage(cellsOf(p), p.pages, cell, rolls.current)) || cell;
        rolls.current = 0;
        if (to !== cell) {
          p.onShow?.(to);
          p.onSwitch?.(cell, to, 'headline');
          setSel(to);
        }
        setShown(to);
        setTurn((n) => n + 1);
      }, FADE_OUT_MS);
    },
    // stop/animate only touch refs
    [sel, ready, p]
  );

  const roll = (): void => {
    if (busy.current) {
      rolls.current += 1;
      return;
    }
    const to = nextWithPage(cellsOf(p), p.pages, sel);
    if (to) pick(to, 'headline');
  };

  const text = p.pages[shown]?.headline ?? '';
  const day = p.pages[sel]?.seenDate ?? '';
  const size = headlineSize(p.frame.width, text);
  const vis = ready ? 'visible' : 'hidden';
  const skeleton = useSkeleton(ready);
  const rootStyle = {
    '--w3-safe-top': p.frame.safeTop + 'px',
    '--w3-safe-bottom': p.frame.safeBottom + 'px',
  } as CSSProperties;

  return (
    <div
      className="mf-w3-root mf-home"
      data-testid="mf-home"
      data-ready={ready ? '' : undefined}
      data-narrow={p.frame.width < NARROW_W ? '' : undefined}
      style={rootStyle}
    >
      <div
        className="mf-home-tint"
        data-testid="mf-home-tint"
        data-tint={homeTint(shown)}
        aria-hidden="true"
      />
      <div className="mf-home-col">
        <HomeHead
          account={p.account}
          onAccount={() => setAcct(true)}
          day={day}
          onDate={p.onPast ? () => p.onPast?.(sel, day) : undefined}
          hidden={!ready}
          dateRef={date}
        />
        <div className="mf-home-gap-top" />
        <div className="mf-home-block" style={{ position: 'relative' }}>
          {skeleton ? <SkeletonLines testId="mf-home-skeleton" /> : null}
          <div style={{ visibility: vis }}>
            <div className="mf-home-meta" ref={meta} data-testid="mf-home-meta">
              <span className="mf-home-meta-k" data-testid="mf-home-domain">
                {p.chips.find((c) => c.cell === sel)?.title ?? ''}
              </span>
            </div>
            <h1
              ref={head}
              className="mf-home-headline"
              data-testid="mf-home-headline"
              data-link=""
              data-press="row"
              onClick={roll}
              style={{
                fontSize: size.fontPx + 'px',
                letterSpacing: size.trackEm + 'em',
                lineHeight: size.lineHeight,
              }}
            >
              {text}
            </h1>
            <div className="mf-home-btn-row" ref={btn}>
              <button
                type="button"
                className="mf-home-btn"
                data-press="fill"
                data-testid="mf-home-enter"
                data-target="page"
                onClick={() => p.onOpenPage(sel)}
              >
                <span>{HOME_BUTTON_LABEL}</span>
                <span className="mf-home-arrow">→</span>
              </button>
            </div>
          </div>
        </div>
        <div className="mf-home-gap-bottom" />
        <div className="mf-home-chips" ref={chipsEl} style={{ visibility: vis }}>
          {p.chips.map((c) => (
            <button
              key={c.cell}
              type="button"
              className="mf-home-chip"
              data-press="btn"
              data-testid="mf-home-chip"
              data-on={c.cell === sel ? '' : undefined}
              data-page={p.pages[c.cell] ? '' : undefined}
              onClick={() => pick(c.cell)}
            >
              {c.title}
            </button>
          ))}
        </div>
      </div>
      {acct && p.account ? (
        <AccountSheet
          account={p.account}
          where={{ screen: 'home', cell: sel, date: p.pages[sel]?.seenDate }}
          onClose={() => setAcct(false)}
        />
      ) : null}
    </div>
  );
}

export interface WatchHomeEmptyProps {
  frame: Frame & { width: number };
  account?: R3AccountView;
  /** Today ('YYYY-MM-DD', the server's): the head's date. */
  today: string;
  /** The existing empty-state text, unchanged. */
  message: string;
}

/**
 * No readable brief at all (every page hidden, or none published yet): the home's own layout (top
 * bar, date, type and tokens) with the empty-state text in the headline's place. No button, no past
 * briefs behind the date and no chips: there is nothing to open (decision 2026-11-24 usability test).
 */
export function WatchHomeEmpty(p: WatchHomeEmptyProps): JSX.Element {
  const [acct, setAcct] = useState(false);
  useEffect(() => ensureHomeFonts(), []);
  const size = headlineSize(p.frame.width, p.message);
  const rootStyle = {
    '--w3-safe-top': p.frame.safeTop + 'px',
    '--w3-safe-bottom': p.frame.safeBottom + 'px',
  } as CSSProperties;
  return (
    <div
      className="mf-w3-root mf-home"
      data-testid="mf-home"
      data-empty=""
      data-ready=""
      data-narrow={p.frame.width < NARROW_W ? '' : undefined}
      style={rootStyle}
    >
      <div className="mf-home-col">
        <HomeHead account={p.account} onAccount={() => setAcct(true)} day={p.today} />
        <div className="mf-home-gap-top" />
        <div className="mf-home-block">
          <h1
            className="mf-home-headline"
            data-testid="mf-home-empty"
            style={{
              fontSize: size.fontPx + 'px',
              letterSpacing: size.trackEm + 'em',
              lineHeight: size.lineHeight,
            }}
          >
            {p.message}
          </h1>
        </div>
        <div className="mf-home-gap-bottom" />
      </div>
      {acct && p.account ? (
        <AccountSheet
          account={p.account}
          where={{ screen: 'empty' }}
          onClose={() => setAcct(false)}
        />
      ) : null}
    </div>
  );
}
