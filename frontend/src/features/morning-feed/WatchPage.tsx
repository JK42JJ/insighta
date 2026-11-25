import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useMemo,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
} from 'react';

import type { MorningPage } from '@/features/morning-cards/api';
import { ensureHomeFonts } from '@/features/morning-feed/watch-home-fonts';
import { recordBriefEvent } from '@/features/morning-feed/brief-events';
import {
  briefText,
  type BriefParagraph,
  type BriefSentence,
  type SentenceSource,
} from '@/features/morning-feed/brief-sentences';
import { formatDuration, youtubeThumb } from '@/features/morning-feed/feed-format';
import { BackButton } from '@/features/morning-feed/BackButton';
import { haptic, popIcon } from '@/features/morning-feed/motion-tokens';
import { briefDateLabel, headlineSize } from '@/features/morning-feed/watch-home-model';
import { shareBrief } from '@/features/morning-feed/share-brief';
import {
  markSentenceHintSeen,
  SENTENCE_HINT,
  SENTENCE_HINT_MS,
  sentenceHintSeen,
} from '@/features/morning-feed/sentence-hint';
import { useReadDepth } from '@/features/morning-feed/use-read-depth';
import { isArticleCore, youtubeAt } from '@/features/morning-feed/watch-page-model';
import type { Frame } from '@/features/morning-feed/watch-r3-layout';
import {
  AccountButton,
  AccountSheet,
  type R3AccountView,
} from '@/features/morning-feed/watch-r3-screens';
import { PageSkeleton } from '@/features/morning-feed/PageSkeleton';
import { useToTop } from '@/features/morning-feed/use-to-top';
import { toast } from '@/shared/ui/sonner';
import './watch-home.css';
import './watch-page.css';

/*
 * "한 장" (design handoff "design_handoff_insighta_page", PagePhone.dc.html is the reference):
 * one domain's day as one long scrolling page. Pretendard body, the source list with thumbnails,
 * light background only (decisions 2026-11-14). The text carries no source marks (order 2026-11-25
 * B5): a tap on a sentence opens its sources' sheet, the paragraph's end says how many videos are
 * behind it. A row of the evidence list opens the video screen (YouTube without the app's handler).
 */

/** Another domain's brief of the same day (order 2026-11-25 B12). */
export interface OtherField {
  cell: string;
  title: string;
  headline: string;
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
  /** 다른 분야: the other domains' headlines of that day; empty = the section is hidden. */
  others: OtherField[];
  /** They came into view (once per page). */
  onOthersView?: () => void;
  onPast: () => void;
  /** A source row: that video in the watch screen (absent = YouTube). */
  onOpenVideo?: OpenVideo;
  /** A sentence: its sources' sheet over the article (absent = plain text). */
  onOpenSource?: OpenSource;
  /** The source shown in the sheet: its sentence is marked, the last lines stay above the sheet. */
  source?: ShownSource | null;
  /** Something that covers the article opens: the sheet goes first (absent = at once). */
  onLeave?: (go: () => void) => void;
  /** This brief's own address, for the share button (absent = not drawn). */
  shareUrl?: string;
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

const runNow = (go: () => void): void => go();

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
  sources: SentenceSource[];
  scope: BriefSentence['scope'];
  from: OpenFrom;
  /** The sentence (brief-sentences.ts). */
  sid: string;
  /** The tapped sentence: gets the focus back when the sheet is gone. */
  el: HTMLElement;
}
type OpenSource = (tap: SourceTap) => void;

export interface ShownSource {
  sid: string;
  /** Changes with every tap on a sentence: it is then moved above the sheet. */
  tap: number;
  /** How much of the lower edge the sheet (or its bar) covers; 0 until it is measured. */
  room: number;
}

/** Room between the marked sentence and the sheet (px). */
const LIT_CLEAR_PX = 16;

/** A press this long is a text selection, not a tap. */
const TAP_MAX_MS = 500;

interface SentencesProps {
  paragraph: BriefParagraph;
  from: OpenFrom;
  onSource?: OpenSource;
  source?: ShownSource | null;
}

/** A paragraph's sentences (each one opens its sources) and how many videos are behind them. */
function Sentences({ paragraph, from, onSource, source }: SentencesProps): JSX.Element {
  const downAt = useRef<number | null>(null);
  const tap = (s: BriefSentence, e: MouseEvent<HTMLElement>): void => {
    const held = downAt.current === null ? 0 : e.timeStamp - downAt.current;
    downAt.current = null;
    if (e.detail !== 0 && held > TAP_MAX_MS) return;
    // text is being selected (long press, or a drag with a mouse)
    const chosen = window.getSelection?.();
    if (chosen && !chosen.isCollapsed && chosen.toString() !== '') return;
    onSource?.({ sources: s.sources, scope: s.scope, from, sid: s.id, el: e.currentTarget });
  };
  return (
    <>
      {paragraph.sentences.map((s, k) => {
        const lit = source?.sid === s.id;
        const tappable = !!onSource && s.sources.length > 0;
        return (
          <Fragment key={s.id}>
            {k > 0 ? ' ' : null}
            <span
              className={lit ? 'mf-page-sent mf-page-lit' : 'mf-page-sent'}
              data-testid="mf-page-sent"
              data-sid={s.id}
              data-lit={lit ? '' : undefined}
              data-tap={tappable ? '' : undefined}
              {...(tappable
                ? {
                    role: 'button',
                    tabIndex: 0,
                    'aria-haspopup': 'dialog' as const,
                    onPointerDown: (e: PointerEvent) => {
                      downAt.current = e.timeStamp;
                    },
                    onClick: (e: MouseEvent<HTMLElement>) => tap(s, e),
                    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
                      if (e.key !== 'Enter' && e.key !== ' ') return;
                      e.preventDefault();
                      e.currentTarget.click();
                    },
                  }
                : {})}
            >
              {s.text}
            </span>
          </Fragment>
        );
      })}
      {paragraph.videoCount > 0 ? (
        <>
          {' '}
          <span className="mf-page-ev" data-testid="mf-page-ev">
            {'근거 영상 ' + paragraph.videoCount + '개'}
          </span>
        </>
      ) : null}
    </>
  );
}

export function WatchPage(p: WatchPageProps): JSX.Element {
  const pg = p.page;
  const [open, setOpen] = useState(false);
  const [moved, setMoved] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);
  const [acct, setAcct] = useState(false);

  // The title is drawn as it stays from the first frame: no waiting for fonts and no fade (the
  // fade made it grey over a finished text, James 2026-11-25). The home has its fonts already.
  useEffect(() => ensureHomeFonts(), []);

  const ownScroll = useRef<HTMLDivElement>(null);
  const scroll = p.scrollRef ?? ownScroll;
  const toTopBtn = useRef<HTMLButtonElement>(null);
  const source = p.source ?? null;
  const room = source?.room ?? 0;
  const toTop = useToTop(scroll, toTopBtn, TO_TOP_AVOID);
  const text = useMemo(() => (pg ? briefText(pg) : null), [pg]);
  const tapSource = { onSource: p.onOpenSource, source };
  useReadDepth(scroll, !!pg, room, (paragraph) =>
    recordBriefEvent('read_depth', { cell: pg?.domain, seenDate: pg?.seen_date, paragraph })
  );

  // once per device: how to reach the sources
  const [hint, setHint] = useState(false);
  const canTap = !!pg && !!p.onOpenSource;
  useEffect(() => {
    if (!canTap || sentenceHintSeen()) return undefined;
    markSentenceHintSeen();
    setHint(true);
    return undefined;
  }, [canTap]);
  useEffect(() => {
    if (!hint) return undefined;
    const t = window.setTimeout(() => setHint(false), SENTENCE_HINT_MS);
    return () => window.clearTimeout(t);
  }, [hint]);
  useEffect(() => {
    if (source) setHint(false);
  }, [source]);

  // The tapped sentence is scrolled up to just above the sheet when the sheet would cover it; the
  // article has that much more room under its last line, so this works there too. Only a tap moves
  // it: what the reader scrolled to since then stays.
  const movedFor = useRef<number | null>(null);
  const { safeTop } = p.frame;
  useLayoutEffect(() => {
    const box = scroll.current;
    if (!source || !box || source.room === 0 || movedFor.current === source.tap) return;
    movedFor.current = source.tap;
    const view = box.getBoundingClientRect();
    const marks = [...box.querySelectorAll('.mf-page-lit')].map((m) => m.getBoundingClientRect());
    if (marks.length === 0) return;
    const top = Math.min(...marks.map((m) => m.top)) - view.top;
    const bottom = Math.max(...marks.map((m) => m.bottom)) - view.top;
    const over = bottom - (view.height - source.room - LIT_CLEAR_PX);
    const by = Math.round(Math.min(over, top - safeTop - LIT_CLEAR_PX));
    if (by <= 0) return;
    if (reducedMotion() || typeof box.scrollTo !== 'function') box.scrollTop += by;
    else box.scrollTo({ top: box.scrollTop + by, behavior: 'smooth' });
  }, [scroll, source, safeTop]);

  const headline = pg?.headline ?? p.title?.headline ?? '';
  const seenDate = pg?.seen_date ?? p.title?.seenDate ?? '';
  const size = headlineSize(p.frame.width, headline);
  const share = (title: string, url: string): void => {
    void shareBrief(title, url).then((r) => {
      if (r === 'shared' || r === 'copied') {
        recordBriefEvent('share', { cell: pg?.domain, seenDate, value: r });
      }
      if (r === 'copied') toast(SHARE_COPIED);
      else if (r === 'failed') toast(SHARE_FAILED);
    });
  };
  const still = !moved || reducedMotion();
  const rootStyle = {
    '--w3-safe-top': p.frame.safeTop + 'px',
    '--w3-safe-bottom': p.frame.safeBottom + 'px',
    '--src-room': room + 'px',
  } as CSSProperties;

  return (
    <div
      className="mf-w3-root mf-home mf-page"
      data-testid="mf-page"
      data-narrow={p.frame.width < NARROW_W ? '' : undefined}
      style={rootStyle}
    >
      <div ref={scroll} className="mf-page-scroll" data-testid="mf-page-scroll">
        <div className="mf-page-top">
          <BackButton label={p.back.label} onBack={p.back.onBack} testId="mf-page-home" />
          {p.account ? (
            <AccountButton
              account={p.account}
              onOpen={() => (p.onLeave ?? runNow)(() => setAcct(true))}
            />
          ) : null}
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
                {text?.core.map((q) => (
                  <p key={q.index} className="mf-page-core-p" data-para={q.index}>
                    <Sentences paragraph={q} from="body" {...tapSource} />
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
                    data-folded={open ? undefined : ''}
                    data-testid="mf-page-note"
                  >
                    <div className="mf-page-note-clip">
                      <div className="mf-page-note-body" data-selectable="">
                        {text?.note.map((s, i) => (
                          <section key={i}>
                            <h2 className="mf-page-h2">{s.heading}</h2>
                            <div className="mf-page-paras">
                              {s.paragraphs.map((q) => (
                                <p key={q.index} className="mf-page-para" data-para={q.index}>
                                  <Sentences paragraph={q} from="note" {...tapSource} />
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
                    <div className="mf-page-video-top">
                      <img
                        className="mf-page-thumb"
                        src={youtubeThumb(v.video_id)}
                        alt=""
                        draggable={false}
                      />
                      <div className="mf-page-video-text">
                        <div className="mf-page-video-title">{v.title}</div>
                        <div className="mf-page-video-ch" data-testid="mf-page-video-ch">
                          {[v.channel, v.duration_sec ? formatDuration(v.duration_sec) : '']
                            .filter((x) => x)
                            .join(' · ')}
                        </div>
                      </div>
                    </div>
                    {v.useful_for ? <div className="mf-page-video-use">{v.useful_for}</div> : null}
                  </a>
                ))}
              </div>

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

              {p.feedback ? (
                // a reaction read later from the server redraws the buttons with it
                <BriefFeedback
                  key={p.feedback.value ?? 'none'}
                  {...p.feedback}
                  onShare={p.shareUrl ? () => share(headline, p.shareUrl!) : undefined}
                />
              ) : null}

              {p.others.length > 0 ? (
                <OtherFields others={p.others} onView={p.onOthersView} scroll={scroll} />
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
      {hint ? (
        <button
          type="button"
          className="mf-page-hint"
          data-testid="mf-page-hint"
          onClick={() => setHint(false)}
        >
          <span role="status">{SENTENCE_HINT}</span>
        </button>
      ) : null}
      {acct && p.account ? (
        <AccountSheet
          account={p.account}
          where={{ screen: 'page', cell: pg?.domain, date: pg?.seen_date ?? seenDate }}
          onClose={() => setAcct(false)}
        />
      ) : null}
    </div>
  );
}

const SHARE_COPIED = '링크를 복사했어요';
const SHARE_FAILED = '링크를 복사하지 못했어요';
/** This much of the list in view counts as seen. */
const OTHERS_VIEW_SHARE = 0.5;

/** 다른 분야 (order 2026-11-25 B12): each opens its brief of that day straight away. */
function OtherFields({
  others,
  onView,
  scroll,
}: {
  others: OtherField[];
  onView?: () => void;
  scroll: RefObject<HTMLElement>;
}): JSX.Element {
  const box = useRef<HTMLDivElement>(null);
  const cb = useRef(onView);
  cb.current = onView;
  useEffect(() => {
    const el = box.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(
      (seen) => {
        if (!seen.some((x) => x.isIntersecting)) return;
        io.disconnect();
        cb.current?.();
      },
      { root: scroll.current, threshold: OTHERS_VIEW_SHARE }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [scroll]);
  return (
    <div ref={box} className="mf-page-others" data-testid="mf-page-others">
      <div className="mf-page-label">다른 분야</div>
      {others.map((o) => (
        <button
          key={o.cell}
          type="button"
          className="mf-page-other"
          data-press="row"
          data-testid="mf-page-other"
          onClick={o.onPick}
        >
          <span className="mf-page-other-k">{o.title}</span>
          <span className="mf-page-other-h">{o.headline}</span>
        </button>
      ))}
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
  /** The share button (absent = not drawn). */
  onShare?: () => void;
}

/**
 * 이 브리프가 쓸모 있었나요 (decision 2026-11-14 user test): the video card's 좋아/별로 buttons.
 * The press shows at once and is saved behind; a failed save goes back and says so briefly.
 */
export function BriefFeedback({ value, onPick, onShare }: BriefFeedbackProps): JSX.Element {
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
        {onShare ? (
          <button
            type="button"
            className="mf-w3-react"
            data-press="icon"
            data-kind="share"
            data-testid="mf-page-share"
            aria-label="공유"
            onClick={onShare}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 15V4M8 8l4-4 4 4M5 13v6h14v-6" />
            </svg>
          </button>
        ) : null}
        {failed ? (
          <span className="mf-page-fb-err" role="status" data-testid="mf-page-feedback-error">
            저장하지 못했습니다
          </span>
        ) : null}
      </div>
    </div>
  );
}
