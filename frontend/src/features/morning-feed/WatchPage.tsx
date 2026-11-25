import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';

import type { MorningPage } from '@/features/morning-cards/api';
import { ensureHomeFonts } from '@/features/morning-feed/watch-home-fonts';
import { BackButton } from '@/features/morning-feed/BackButton';
import { haptic, popIcon } from '@/features/morning-feed/motion-tokens';
import { briefDateLabel, headlineSize } from '@/features/morning-feed/watch-home-model';
import {
  articleParagraphs,
  citeLinks,
  isArticleCore,
  youtubeAt,
  type CiteLink,
} from '@/features/morning-feed/watch-page-model';
import type { Frame } from '@/features/morning-feed/watch-r3-layout';
import {
  AccountButton,
  AccountSheet,
  type R3AccountView,
} from '@/features/morning-feed/watch-r3-screens';
import { PageSkeleton } from '@/features/morning-feed/PageSkeleton';
import { useToTop } from '@/features/morning-feed/use-to-top';
import './watch-home.css';
import './watch-page.css';

/*
 * "한 장" (design handoff "design_handoff_insighta_page", PagePhone.dc.html is the reference):
 * one domain's day as one long scrolling page. Pretendard body, the source list with thumbnails,
 * light background only (decisions 2026-11-14). Source links follow the revised handoff: one space
 * after the last character, then each link as an inline-block that does not wrap inside, so only
 * the links move to the next line and the last word stays (core sentences and note paragraphs
 * alike). In the app a source link opens its sheet and a source row the video screen; without
 * the app's handlers both open YouTube at that second in a new window.
 */

export interface PageRestChip {
  cell: string;
  title: string;
  onPick: () => void;
}

export interface WatchPageProps {
  frame: Frame & { width: number };
  account?: R3AccountView;
  /** The brief; null = its text is still being read (the title and date below are drawn already). */
  page: MorningPage | null;
  /** The title and date handed over by the screen it was opened from, until the brief is read. */
  title?: { headline: string; seenDate: string };
  /** The domain as the chips write it ('기술·개발'). */
  domainTitle: string;
  /** Today ('YYYY-MM-DD', the server's day): a brief of that date reads '오늘 · …'. */
  today: string;
  /** Top left: back to the screen this came from ("‹ 홈"). */
  back: { label: string; onBack: () => void };
  /** 이 브리프가 쓸모 있었나요 (absent = not drawn). */
  feedback?: BriefFeedbackProps;
  /** 본 순서 (main account only): that day's watch record; empty = the section is hidden. */
  order: Array<{ key: string; title: string }>;
  /** 남은 도메인: goals with videos left today; empty = the section is hidden. */
  rest: PageRestChip[];
  onPast: () => void;
  /** A source row: that video in the watch screen (absent = YouTube). */
  onOpenVideo?: OpenVideo;
  /** A source link in the text: its sheet over the article (absent = as a source row). */
  onOpenSource?: OpenSource;
  /** The source shown in the sheet: its sentence is marked and kept above the sheet. */
  source?: ShownSource | null;
  /** The article's scroll box, for the caller that restores its position. */
  scrollRef?: RefObject<HTMLDivElement>;
  /** Videos of this domain left today: the "오늘의 영상 모두 보기 (n편)" link (absent = hidden). */
  todayVideos?: { count: number; onGo: () => void };
}

/** 오늘 본 순서 shows at most this many rows before it scrolls inside (decision 2026-11-14). */
const ORDER_MAX_ROWS = 20;

const NARROW_W = 360;

/** The "up" button never lies on the reaction area at the article's end. */
const TO_TOP_AVOID = '[data-testid="mf-page-feedback"]';

function reducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  );
}

/** In the app (2026-11-14): a link opens the watch screen; the address stays as the fallback. */
type OpenVideo = (videoId: string, t: number, from: OpenFrom) => void;
/** Where on the page a video was opened from (usage records tell a body link from a list row). */
export type OpenFrom = 'body' | 'note' | 'list';

export interface SourceTap {
  videoId: string;
  t: number;
  from: OpenFrom;
  /** The sentence (or note paragraph) the link belongs to. */
  sid: string;
  /** The tapped link: gets the focus back when the sheet is gone. */
  el: HTMLElement;
}
type OpenSource = (tap: SourceTap) => void;

export interface ShownSource {
  videoId: string;
  t: number;
  sid: string;
  /** The sheet's height; 0 until it is measured. */
  sheetH: number;
}

/** Room between the marked sentence and the sheet (px). */
const LIT_CLEAR_PX = 16;

interface CiteProps {
  links: CiteLink[];
  sid: string;
  from: OpenFrom;
  onOpen?: OpenVideo;
  onSource?: OpenSource;
  source?: ShownSource | null;
}

/** A sentence, marked while its source is shown in the sheet. */
function Said({
  text,
  sid,
  cited,
  source,
}: {
  text: string;
  sid: string;
  cited: boolean;
  source?: ShownSource | null;
}): JSX.Element {
  const space: ReactNode = cited ? ' ' : null;
  if (source?.sid !== sid) return <>{cited ? text + ' ' : text}</>;
  return (
    <>
      <span className="mf-page-lit" data-testid="mf-page-lit">
        {text}
      </span>
      {space}
    </>
  );
}

/**
 * One video's links (channel and its times) as one unit that does not wrap inside (decision
 * 2026-11-14: a second time was left alone on the next line); units of different videos can
 * still wrap between them.
 */
function Cites({ links, ...rest }: CiteProps): JSX.Element {
  const groups: CiteLink[][] = [];
  for (const c of links) {
    const last = groups[groups.length - 1];
    if (last && last[0]!.videoId === c.videoId) last.push(c);
    else groups.push([c]);
  }
  return (
    <>
      {groups.map((g, k) => (
        <span key={k} className="mf-page-cite-group" data-testid="mf-page-cite-group">
          <CiteLinks links={g} {...rest} />
        </span>
      ))}
    </>
  );
}

function CiteLinks({ links, sid, from, onOpen, onSource, source }: CiteProps): JSX.Element {
  const isShown = (c: CiteLink): boolean =>
    !!source && source.sid === sid && source.videoId === c.videoId && source.t === c.t;
  return (
    <>
      {links.map((c, i) => (
        <a
          key={i}
          className="mf-page-cite"
          data-press="link"
          data-gap={c.gap}
          data-shown={isShown(c) ? '' : undefined}
          data-testid="mf-page-cite"
          href={c.href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={
            onSource || onOpen
              ? (e) => {
                  e.preventDefault();
                  if (onSource) {
                    onSource({ videoId: c.videoId, t: c.t, from, sid, el: e.currentTarget });
                  } else onOpen?.(c.videoId, c.t, from);
                }
              : undefined
          }
        >
          {c.label}
        </a>
      ))}
    </>
  );
}

export function WatchPage(p: WatchPageProps): JSX.Element {
  const pg = p.page;
  const [open, setOpen] = useState(false);
  const [moved, setMoved] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);
  const [acct, setAcct] = useState(false);
  const channelOf = (id: string): string =>
    pg?.videos.find((v) => v.video_id === id)?.channel ?? '';

  // The title is drawn as it stays from the first frame: no waiting for fonts and no fade (the
  // fade made it grey over a finished text, James 2026-11-25). The home has its fonts already.
  useEffect(() => ensureHomeFonts(), []);

  const ownScroll = useRef<HTMLDivElement>(null);
  const scroll = p.scrollRef ?? ownScroll;
  const toTopBtn = useRef<HTMLButtonElement>(null);
  const source = p.source ?? null;
  const toTop = useToTop(scroll, toTopBtn, TO_TOP_AVOID, !!source);
  const citeOpen = { onOpen: p.onOpenVideo, onSource: p.onOpenSource, source };

  // The sentence is kept above the sheet by moving the whole scroll box up, so the article's own
  // scroll position never changes and closing only moves the box back.
  const [shift, setShift] = useState(0);
  const { safeTop, vh } = p.frame;
  useLayoutEffect(() => {
    const box = scroll.current;
    if (!source || !box) {
      setShift(0);
      return;
    }
    if (source.sheetH === 0) return;
    const base = box.getBoundingClientRect().top;
    const marks = [...box.querySelectorAll('.mf-page-lit, .mf-page-cite[data-shown]')].map((m) =>
      m.getBoundingClientRect()
    );
    if (marks.length === 0) return;
    const top = Math.min(...marks.map((m) => m.top)) - base;
    const bottom = Math.max(...marks.map((m) => m.bottom)) - base;
    const limit = vh - source.sheetH - LIT_CLEAR_PX;
    const lo = Math.max(0, bottom - limit);
    // a switch keeps the box where it is when the new sentence is already in view
    const hi = Math.max(lo, top - safeTop - LIT_CLEAR_PX);
    setShift((was) => Math.round(Math.min(Math.max(was, lo), hi, source.sheetH)));
  }, [scroll, source, vh, safeTop]);

  const headline = pg?.headline ?? p.title?.headline ?? '';
  const seenDate = pg?.seen_date ?? p.title?.seenDate ?? '';
  const size = headlineSize(p.frame.width, headline);
  const still = !moved || reducedMotion();
  const rootStyle = {
    '--w3-safe-top': p.frame.safeTop + 'px',
    '--w3-safe-bottom': p.frame.safeBottom + 'px',
  } as CSSProperties;

  return (
    <div
      className="mf-w3-root mf-home mf-page"
      data-testid="mf-page"
      data-narrow={p.frame.width < NARROW_W ? '' : undefined}
      style={rootStyle}
    >
      <div
        ref={scroll}
        className="mf-page-scroll"
        data-testid="mf-page-scroll"
        data-locked={source ? '' : undefined}
        style={shift > 0 ? { transform: `translate3d(0,${-shift}px,0)` } : undefined}
      >
        <div className="mf-page-top">
          <BackButton label={p.back.label} onBack={p.back.onBack} testId="mf-page-home" />
          {p.account ? <AccountButton account={p.account} onOpen={() => setAcct(true)} /> : null}
        </div>
        <div>
          <div className="mf-page-meta">
            <span className="mf-page-dom">{p.domainTitle}</span>
            <span className="mf-home-meta-d" data-testid="mf-page-seen">
              {briefDateLabel(seenDate, p.today)}
            </span>
          </div>
          <h1
            className="mf-home-headline"
            data-testid="mf-page-headline"
            style={{
              fontSize: size.fontPx + 'px',
              letterSpacing: size.trackEm + 'em',
              lineHeight: size.lineHeight,
            }}
          >
            {headline}
          </h1>

          {pg ? (
            <>
              <div
                className="mf-page-core"
                data-testid="mf-page-core"
                data-selectable=""
                data-article={isArticleCore(pg.core) ? '' : undefined}
              >
                {isArticleCore(pg.core)
                  ? // article format (2026-11-22): 1 to 2 paragraphs; each sentence's sources right
                    // after that sentence (decision 2026-11-24)
                    articleParagraphs(pg.core).map((q, i) => (
                      <p
                        key={i}
                        className="mf-page-core-p"
                        data-cited={q.sentences.some((s) => s.sources.length > 0) ? '' : undefined}
                      >
                        {q.sentences.map((s, k) => (
                          <Fragment key={k}>
                            {k > 0 ? ' ' : null}
                            <Said
                              text={s.text}
                              sid={`c${i}-${k}`}
                              cited={s.sources.length > 0}
                              source={p.source}
                            />
                            <Cites
                              links={citeLinks(s.sources, channelOf)}
                              sid={`c${i}-${k}`}
                              from="body"
                              {...citeOpen}
                            />
                          </Fragment>
                        ))}
                      </p>
                    ))
                  : pg.core.map((c, i) => (
                      <p
                        key={i}
                        className="mf-page-core-p"
                        data-cited={c.sources.length > 0 ? '' : undefined}
                      >
                        <Said
                          text={c.text}
                          sid={`c${i}`}
                          cited={c.sources.length > 0}
                          source={p.source}
                        />
                        <Cites
                          links={citeLinks(c.sources, channelOf)}
                          sid={`c${i}`}
                          from="body"
                          {...citeOpen}
                        />
                      </p>
                    ))}
              </div>

              {pg.note.length > 0 ? (
                <>
                  <button
                    type="button"
                    className="mf-page-toggle"
                    data-press="link"
                    data-testid="mf-page-note-toggle"
                    aria-expanded={open}
                    onClick={() => {
                      setMoved(true);
                      setOpen((o) => !o);
                    }}
                  >
                    <span>{open ? '접기' : '이어서 읽기'}</span>
                    <span className="mf-page-sign">{open ? '−' : '＋'}</span>
                  </button>
                  <div
                    className="mf-page-note"
                    data-open={open ? '' : undefined}
                    data-still={still ? '' : undefined}
                    data-testid="mf-page-note"
                  >
                    <div className="mf-page-note-clip">
                      <div className="mf-page-note-body" data-selectable="">
                        {pg.note.map((s, i) => (
                          <section key={i}>
                            <h2 className="mf-page-h2">{s.heading}</h2>
                            <div className="mf-page-paras">
                              {s.paragraphs.map((q, k) => (
                                <p
                                  key={k}
                                  className="mf-page-para"
                                  data-cited={q.sources.length > 0 ? '' : undefined}
                                >
                                  <Said
                                    text={q.text}
                                    sid={`n${i}-${k}`}
                                    cited={q.sources.length > 0}
                                    source={p.source}
                                  />
                                  <Cites
                                    links={citeLinks(q.sources, channelOf)}
                                    sid={`n${i}-${k}`}
                                    from="note"
                                    {...citeOpen}
                                  />
                                </p>
                              ))}
                            </div>
                          </section>
                        ))}
                      </div>
                    </div>
                  </div>
                </>
              ) : null}

              <div className="mf-page-src" data-testid="mf-page-videos">
                <div className="mf-page-label">근거가 된 영상</div>
                {pg.videos.map((v) => (
                  <a
                    key={v.video_id}
                    className="mf-page-video"
                    data-press="row"
                    data-testid="mf-page-video"
                    href={youtubeAt(v.video_id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={
                      p.onOpenVideo
                        ? (e) => {
                            e.preventDefault();
                            p.onOpenVideo?.(v.video_id, 0, 'list');
                          }
                        : undefined
                    }
                  >
                    <div className="mf-page-video-text">
                      <div className="mf-page-video-title">{v.title}</div>
                      <div className="mf-page-video-ch">{v.channel}</div>
                      {v.useful_for ? (
                        <div className="mf-page-video-use">{v.useful_for}</div>
                      ) : null}
                    </div>
                    <img
                      className="mf-page-thumb"
                      src={'https://i.ytimg.com/vi/' + v.video_id + '/mqdefault.jpg'}
                      alt=""
                    />
                  </a>
                ))}
              </div>

              {p.feedback ? (
                // a reaction read later from the server redraws the buttons with it
                <BriefFeedback key={p.feedback.value ?? 'none'} {...p.feedback} />
              ) : null}

              {p.order.length > 0 ? (
                <div className="mf-page-order" data-testid="mf-page-order">
                  <button
                    type="button"
                    className="mf-page-order-btn"
                    data-press="link"
                    aria-expanded={orderOpen}
                    onClick={() => setOrderOpen((o) => !o)}
                  >
                    <span>오늘 본 순서</span>
                    <span className="mf-page-sign">{orderOpen ? '−' : '＋'}</span>
                  </button>
                  {orderOpen ? (
                    <div
                      className="mf-page-order-list"
                      data-testid="mf-page-order-list"
                      data-capped={p.order.length > ORDER_MAX_ROWS ? '' : undefined}
                    >
                      {p.order.map((r, i) => (
                        <div key={r.key} className="mf-page-order-row">
                          <span className="mf-page-order-n">{i + 1}</span>
                          <span className="mf-page-order-t">{r.title}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {p.todayVideos && p.todayVideos.count > 0 ? (
                <button
                  type="button"
                  className="mf-page-past mf-page-today"
                  data-press="link"
                  data-testid="mf-page-today"
                  onClick={p.todayVideos.onGo}
                >
                  <span>{'오늘의 영상 모두 보기 (' + p.todayVideos.count + '편)'}</span>
                  <span className="mf-page-past-arrow">→</span>
                </button>
              ) : null}

              {p.rest.length > 0 ? (
                <div className="mf-page-rest" data-testid="mf-page-rest">
                  <div className="mf-page-label">다른 분야</div>
                  <div className="mf-home-chips">
                    {p.rest.map((c) => (
                      <button
                        key={c.cell}
                        type="button"
                        className="mf-home-chip"
                        data-press="btn"
                        data-testid="mf-page-rest-chip"
                        onClick={c.onPick}
                      >
                        {c.title}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              <button
                type="button"
                className="mf-page-past"
                data-press="link"
                data-testid="mf-page-past"
                onClick={p.onPast}
              >
                <span>지난 브리프</span>
                <span className="mf-page-past-arrow">→</span>
              </button>
            </>
          ) : (
            <PageSkeleton />
          )}
        </div>
      </div>
      <div className="mf-page-safe-top" aria-hidden="true" />
      <button
        ref={toTopBtn}
        type="button"
        className="mf-page-up"
        data-press="soft"
        data-testid="mf-page-up"
        data-shown={toTop.shown ? '' : undefined}
        data-over={toTop.over ? '' : undefined}
        aria-label="맨 위로"
        aria-hidden={toTop.shown ? undefined : true}
        tabIndex={toTop.shown ? undefined : -1}
        onClick={toTop.go}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M10 16V4M5 9l5-5 5 5" />
        </svg>
      </button>
      {acct && p.account ? (
        <AccountSheet
          account={p.account}
          where={{ screen: 'page', cell: pg.domain, date: pg.seen_date }}
          onClose={() => setAcct(false)}
        />
      ) : null}
    </div>
  );
}

export type BriefFeedbackValue = 'useful' | 'not_useful';

/** How long the "could not save" note stays. */
const FEEDBACK_ERROR_MS = 2500;

export interface BriefFeedbackProps {
  value: BriefFeedbackValue | null;
  /** Saves in the background; rejects when it could not be saved (the press is undone). */
  onPick: (v: BriefFeedbackValue) => Promise<void>;
}

/**
 * 이 브리프가 쓸모 있었나요 (decision 2026-11-14 user test): the video card's 좋아/별로 buttons.
 * The press shows at once and is saved behind; a failed save goes back and says so briefly.
 */
export function BriefFeedback({ value, onPick }: BriefFeedbackProps): JSX.Element {
  const [v, setV] = useState<BriefFeedbackValue | null>(value);
  const [failed, setFailed] = useState(false);
  const like = useRef<HTMLButtonElement>(null);
  const dislike = useRef<HTMLButtonElement>(null);
  // the failure note shows briefly
  useEffect(() => {
    if (!failed) return undefined;
    const t = window.setTimeout(() => setFailed(false), FEEDBACK_ERROR_MS);
    return () => window.clearTimeout(t);
  }, [failed]);
  const pick = (next: BriefFeedbackValue): void => {
    if (next === v) return;
    const was = v;
    setV(next);
    setFailed(false);
    haptic();
    popIcon(next === 'useful' ? like.current : dislike.current);
    onPick(next).catch(() => {
      setV(was);
      setFailed(true);
    });
  };
  return (
    <div className="mf-page-fb" data-testid="mf-page-feedback" data-value={v ?? undefined}>
      <div className="mf-page-fb-q">이 브리프가 쓸모 있었나요</div>
      <div className="mf-page-fb-row">
        <button
          ref={dislike}
          type="button"
          className="mf-w3-react"
          data-press="icon"
          data-kind="dislike"
          data-on={v === 'not_useful' ? '' : undefined}
          data-testid="mf-page-feedback-no"
          aria-label="별로"
          aria-pressed={v === 'not_useful'}
          onClick={() => pick('not_useful')}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M17 14V2" />
            <path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z" />
          </svg>
        </button>
        <button
          ref={like}
          type="button"
          className="mf-w3-react"
          data-press="icon"
          data-kind="like"
          data-on={v === 'useful' ? '' : undefined}
          data-testid="mf-page-feedback-yes"
          aria-label="좋아"
          aria-pressed={v === 'useful'}
          onClick={() => pick('useful')}
        >
          <svg
            width="21"
            height="21"
            viewBox="0 0 24 24"
            fill={v === 'useful' ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 20.5s-7.5-4.6-7.5-10A4.2 4.2 0 0 1 12 8a4.2 4.2 0 0 1 7.5 2.5c0 5.4-7.5 10-7.5 10z" />
          </svg>
        </button>
        {failed ? (
          <span className="mf-page-fb-err" role="status" data-testid="mf-page-feedback-error">
            저장하지 못했습니다
          </span>
        ) : null}
      </div>
    </div>
  );
}
