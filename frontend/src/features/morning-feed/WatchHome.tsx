import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';

import { ensureHomeFonts, waitHomeFonts } from '@/features/morning-feed/watch-home-fonts';
import {
  headlineSize,
  homeButtonOf,
  seenDateLabel,
} from '@/features/morning-feed/watch-home-model';
import type { Frame } from '@/features/morning-feed/watch-r3-layout';
import {
  AccountButton,
  AccountSheet,
  type R3AccountView,
} from '@/features/morning-feed/watch-r3-screens';
import './watch-home.css';

/*
 * Daily home (design handoff "design_handoff_insighta_home", HomeMotionPhone.dc.html is the
 * reference): yesterday's headline of the last watched domain, the date it was seen, the button
 * into today's videos and the domain chips. Light background only (decision 2026-11-14).
 *
 * Motion (README "한 덩어리 페이드"): the headline fades as one element, opacity only. Entrance:
 * headline 0->1 450 ms ease-out, then the seen-date row, button and chips 0->1 300 ms ease-out
 * at 450 ms. Domain switch: the chip changes at once (0.2 s colour), the headline fades out
 * 180 ms ease-in, the text changes, it fades in 450 ms ease-out while the seen-date row and the
 * button slide from where they were in 300 ms cubic-bezier(.2,.8,.2,1). Taps during a switch are
 * ignored. Reduced motion: no motion at all. The motion waits for the fonts at most 1.5 s.
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
  /** The user's goal in the top row (decision 2026-11-14: in place of the date); null = empty. */
  goal: string | null;
  account?: R3AccountView;
  chips: HomeChip[];
  /** Domains with a page: their newest headline and seen date. */
  pages: Record<string, HomeHeadline>;
  /** The last watched domain (it has a page). */
  initial: string;
  /** Today in KST ('YYYY-MM-DD'): a page of that date is "today's page". */
  today: string;
  /** Today's videos left for the domain (0 = none). */
  todayCount: (cell: string) => number;
  /** The button, or a chip of a domain without a page: today's videos of that domain. */
  onOpen: (cell: string) => void;
  /** Tapping the headline: that domain's page (absent = not tappable). */
  onOpenPage?: (cell: string) => void;
  /** The link at the right end of the seen-date row: past pages (absent = not drawn). */
  onPast?: (cell: string) => void;
}

const FADE_IN_MS = 450;
const REST_IN_MS = 300;
const FADE_OUT_MS = 180;
const SLIDE_MS = 300;
const SLIDE_EASE = 'cubic-bezier(.2,.8,.2,1)';
/** Below this width the chips use 12.5 px (README §배치 5). */
const NARROW_W = 360;
const UI_TEXT =
  '오늘의 장 최근 장 지난 장 읽기 이 장 읽기 오늘의 영상 편 보기 →0123456789월일요화수목금토';

function reducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  );
}

export function WatchHome(p: WatchHomeProps): JSX.Element {
  const [sel, setSel] = useState(p.initial);
  const [shown, setShown] = useState(p.initial);
  const [ready, setReady] = useState(false);
  const [acct, setAcct] = useState(false);
  const head = useRef<HTMLHeadingElement>(null);
  const meta = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLDivElement>(null);
  const chipsEl = useRef<HTMLDivElement>(null);
  const anims = useRef<Animation[]>([]);
  const busy = useRef(false);
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
    [meta.current, btn.current, chipsEl.current].forEach((el) =>
      animate(el, [{ opacity: 0 }, { opacity: 1 }], {
        duration: REST_IN_MS,
        delay: FADE_IN_MS,
        easing: 'ease-out',
      })
    );
  }, [ready]);

  // after the text changed: fade in, and slide the date row and button from where they were
  useLayoutEffect(() => {
    const before = swap.current;
    if (!before) return;
    swap.current = null;
    stop();
    animate(head.current, [{ opacity: 0 }, { opacity: 1 }], {
      duration: FADE_IN_MS,
      easing: 'ease-out',
    });
    const slide = (el: HTMLElement | null, was: number | null): void => {
      if (!el || was == null) return;
      const d = was - el.offsetTop;
      if (d)
        animate(el, [{ transform: 'translateY(' + d + 'px)' }, { transform: 'none' }], {
          duration: SLIDE_MS,
          easing: SLIDE_EASE,
        });
    };
    slide(meta.current, before.meta);
    slide(btn.current, before.btn);
    busy.current = false;
  }, [shown]);

  const pick = useCallback(
    (cell: string) => {
      if (busy.current || cell === sel) return;
      if (!p.pages[cell]) {
        p.onOpen(cell);
        return;
      }
      stop();
      if (reducedMotion() || !ready) {
        setSel(cell);
        setShown(cell);
        return;
      }
      busy.current = true;
      animate(head.current, [{ opacity: 1 }, { opacity: 0 }], {
        duration: FADE_OUT_MS,
        easing: 'ease-in',
        fill: 'forwards',
      });
      const was = {
        meta: meta.current ? meta.current.offsetTop : null,
        btn: btn.current ? btn.current.offsetTop : null,
      };
      setSel(cell);
      timer.current = window.setTimeout(() => {
        swap.current = was;
        setShown(cell);
      }, FADE_OUT_MS);
    },
    // stop/animate only touch refs
    [sel, ready, p]
  );

  const page = p.pages[shown];
  // the button follows the shown headline (it changes with the text, not before the fade)
  const button = homeButtonOf(page?.seenDate, p.today, p.todayCount(shown));
  const text = page?.headline ?? '';
  const size = headlineSize(p.frame.width, text);
  const vis = ready ? 'visible' : 'hidden';
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
      <div className="mf-home-col">
        <div className="mf-home-top">
          <div className="mf-w3-brand mf-home-brand">Insighta</div>
          <div
            className="mf-home-today mf-home-goal"
            data-testid="mf-home-goal"
            title={p.goal ?? ''}
          >
            {p.goal ?? ''}
          </div>
          {p.account ? <AccountButton account={p.account} onOpen={() => setAcct(true)} /> : null}
        </div>
        <div className="mf-home-gap-top" />
        <div className="mf-home-block" style={{ visibility: vis }}>
          <div className="mf-home-meta" ref={meta} data-testid="mf-home-meta">
            <span className="mf-home-meta-k">
              {page && page.seenDate === p.today ? '오늘의 장' : '최근 장'}
            </span>
            <span className="mf-home-meta-d" data-testid="mf-home-seen">
              {page ? seenDateLabel(page.seenDate) : ''}
            </span>
            {p.onPast ? (
              <button
                type="button"
                className="mf-home-past"
                data-testid="mf-home-past"
                onClick={() => p.onPast?.(sel)}
              >
                지난 장
              </button>
            ) : null}
          </div>
          <h1
            ref={head}
            className="mf-home-headline"
            data-testid="mf-home-headline"
            data-link={p.onOpenPage ? '' : undefined}
            onClick={p.onOpenPage ? () => p.onOpenPage?.(shown) : undefined}
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
              data-testid="mf-home-enter"
              data-target={button.target}
              onClick={() => (button.target === 'videos' ? p.onOpen(shown) : p.onOpenPage?.(shown))}
            >
              <span>{button.label}</span>
              <span className="mf-home-arrow">→</span>
            </button>
          </div>
        </div>
        <div className="mf-home-gap-bottom" />
        <div className="mf-home-chips" ref={chipsEl} style={{ visibility: vis }}>
          {p.chips.map((c) => (
            <button
              key={c.cell}
              type="button"
              className="mf-home-chip"
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
        <AccountSheet account={p.account} onClose={() => setAcct(false)} />
      ) : null}
    </div>
  );
}
