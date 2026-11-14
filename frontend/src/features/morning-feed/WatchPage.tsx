import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';

import type { MorningPage } from '@/features/morning-cards/api';
import { ensureHomeFonts, waitHomeFonts } from '@/features/morning-feed/watch-home-fonts';
import { headlineSize, seenDateLabel } from '@/features/morning-feed/watch-home-model';
import { citeLinks, youtubeAt, type CiteLink } from '@/features/morning-feed/watch-page-model';
import type { Frame } from '@/features/morning-feed/watch-r3-layout';
import {
  AccountButton,
  AccountSheet,
  type R3AccountView,
} from '@/features/morning-feed/watch-r3-screens';
import './watch-home.css';
import './watch-page.css';

/*
 * "한 장" (design handoff "design_handoff_insighta_page", PagePhone.dc.html is the reference):
 * one domain's day as one long scrolling page. Pretendard body, the source list with thumbnails,
 * light background only (decisions 2026-11-14). Source links follow the revised handoff: one space
 * after the last character, then each link as an inline-block that does not wrap inside, so only
 * the links move to the next line and the last word stays (core sentences and note paragraphs
 * alike). Every source link and source row opens YouTube at that second in a new window.
 */

export interface PageRestChip {
  cell: string;
  title: string;
  onPick: () => void;
}

export interface WatchPageProps {
  frame: Frame & { width: number };
  account?: R3AccountView;
  page: MorningPage;
  /** The domain as the chips write it ('기술·개발'). */
  domainTitle: string;
  /** 본 순서: that day's watch record; empty = the section is hidden. */
  order: Array<{ key: string; title: string }>;
  /** 남은 도메인: goals with videos left today; empty = the section is hidden. */
  rest: PageRestChip[];
  onHome: () => void;
  onPast: () => void;
  /** A source link or a source row: that video in the watch screen (absent = YouTube). */
  onOpenVideo?: OpenVideo;
}

const FADE_IN_MS = 450;
const NARROW_W = 360;

function reducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  );
}

/** In the app (2026-11-14): a link opens the watch screen; the address stays as the fallback. */
type OpenVideo = (videoId: string, t: number) => void;

function Cites({ links, onOpen }: { links: CiteLink[]; onOpen?: OpenVideo }): JSX.Element {
  return (
    <>
      {links.map((c, i) => (
        <a
          key={i}
          className="mf-page-cite"
          data-gap={c.gap}
          data-testid="mf-page-cite"
          href={c.href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={
            onOpen
              ? (e) => {
                  e.preventDefault();
                  onOpen(c.videoId, c.t);
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
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [moved, setMoved] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);
  const [acct, setAcct] = useState(false);
  const head = useRef<HTMLHeadingElement>(null);
  const fade = useRef(false);
  const channelOf = (id: string): string => pg.videos.find((v) => v.video_id === id)?.channel ?? '';

  useEffect(() => {
    let alive = true;
    ensureHomeFonts();
    const heads = [pg.headline, ...pg.note.map((n) => n.heading)].join(' ');
    const ui = p.domainTitle + ' [문구] ' + pg.core.map((c) => c.text).join(' ');
    void waitHomeFonts(heads, ui).then((r) => {
      if (!alive) return;
      fade.current = r === 'ready' && !reducedMotion();
      setReady(true);
    });
    return () => {
      alive = false;
    };
    // one page per mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useLayoutEffect(() => {
    if (!ready || !fade.current) return;
    fade.current = false;
    head.current?.animate?.([{ opacity: 0 }, { opacity: 1 }], {
      duration: FADE_IN_MS,
      easing: 'ease-out',
    });
  }, [ready]);

  const size = headlineSize(p.frame.width, pg.headline);
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
      <div className="mf-page-scroll" data-testid="mf-page-scroll">
        <div className="mf-page-top">
          <button
            type="button"
            className="mf-w3-brand mf-page-brand"
            data-testid="mf-page-home"
            onClick={p.onHome}
          >
            Insighta
          </button>
          {p.account ? <AccountButton account={p.account} onOpen={() => setAcct(true)} /> : null}
        </div>
        <div style={{ visibility: ready ? 'visible' : 'hidden' }}>
          <div className="mf-page-meta">
            <span className="mf-page-dom">{p.domainTitle}</span>
            <span className="mf-home-meta-d" data-testid="mf-page-seen">
              {seenDateLabel(pg.seen_date)}
            </span>
          </div>
          <h1
            ref={head}
            className="mf-home-headline"
            data-testid="mf-page-headline"
            style={{
              fontSize: size.fontPx + 'px',
              letterSpacing: size.trackEm + 'em',
              lineHeight: size.lineHeight,
            }}
          >
            {pg.headline}
          </h1>

          <div className="mf-page-core" data-testid="mf-page-core">
            {pg.core.map((c, i) => (
              <p
                key={i}
                className="mf-page-core-p"
                data-cited={c.sources.length > 0 ? '' : undefined}
              >
                {c.sources.length > 0 ? c.text + ' ' : c.text}
                <Cites links={citeLinks(c.sources, channelOf)} onOpen={p.onOpenVideo} />
              </p>
            ))}
          </div>

          {pg.note.length > 0 ? (
            <>
              <button
                type="button"
                className="mf-page-toggle"
                data-testid="mf-page-note-toggle"
                aria-expanded={open}
                onClick={() => {
                  setMoved(true);
                  setOpen((o) => !o);
                }}
              >
                <span>[문구]</span>
                <span className="mf-page-sign">{open ? '−' : '＋'}</span>
              </button>
              <div
                className="mf-page-note"
                data-open={open ? '' : undefined}
                data-still={still ? '' : undefined}
                data-testid="mf-page-note"
              >
                <div className="mf-page-note-clip">
                  <div className="mf-page-note-body">
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
                              {q.sources.length > 0 ? q.text + ' ' : q.text}
                              <Cites
                                links={citeLinks(q.sources, channelOf)}
                                onOpen={p.onOpenVideo}
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
            <div className="mf-page-label">[문구]</div>
            {pg.videos.map((v) => (
              <a
                key={v.video_id}
                className="mf-page-video"
                data-testid="mf-page-video"
                href={youtubeAt(v.video_id)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={
                  p.onOpenVideo
                    ? (e) => {
                        e.preventDefault();
                        p.onOpenVideo?.(v.video_id, 0);
                      }
                    : undefined
                }
              >
                <div className="mf-page-video-text">
                  <div className="mf-page-video-title">{v.title}</div>
                  <div className="mf-page-video-ch">{v.channel}</div>
                  {v.useful_for ? <div className="mf-page-video-use">{v.useful_for}</div> : null}
                </div>
                <img
                  className="mf-page-thumb"
                  src={'https://i.ytimg.com/vi/' + v.video_id + '/mqdefault.jpg'}
                  alt=""
                />
              </a>
            ))}
          </div>

          {p.order.length > 0 ? (
            <div className="mf-page-order" data-testid="mf-page-order">
              <button
                type="button"
                className="mf-page-order-btn"
                aria-expanded={orderOpen}
                onClick={() => setOrderOpen((o) => !o)}
              >
                <span>[문구]</span>
                <span className="mf-page-sign">{orderOpen ? '−' : '＋'}</span>
              </button>
              {orderOpen ? (
                <div className="mf-page-order-list">
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

          {p.rest.length > 0 ? (
            <div className="mf-page-rest" data-testid="mf-page-rest">
              <div className="mf-page-label">[문구]</div>
              <div className="mf-home-chips">
                {p.rest.map((c) => (
                  <button
                    key={c.cell}
                    type="button"
                    className="mf-home-chip"
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
            data-testid="mf-page-past"
            onClick={p.onPast}
          >
            <span>[문구]</span>
            <span className="mf-page-past-arrow">→</span>
          </button>
        </div>
      </div>
      <div className="mf-page-safe-top" aria-hidden="true" />
      {acct && p.account ? (
        <AccountSheet account={p.account} onClose={() => setAcct(false)} />
      ) : null}
    </div>
  );
}
