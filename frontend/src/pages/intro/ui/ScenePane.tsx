import { memo, useMemo, useState, type CSSProperties, type RefObject } from 'react';

import {
  ADD_LABEL,
  BRAND,
  BRIEF_KICKER,
  domainsLead,
  FINAL_LINE,
  LOGIN_LABEL,
  PRIVACY,
  S0_BODY,
  S0_TITLE,
  S1_BODY,
  S1_TITLE,
  S2_BODY,
  S2_TITLE,
  S3_BODY,
  S3_TITLE,
  S4_BODY,
  S4_TITLE,
  S5_BODY,
  S5_TITLE,
  S7_BODY,
  S7_TITLE,
  SWIPE_HINT,
  TERMS,
  YT_CREDIT,
  YT_ICON_ALT,
  ytPlayLabel,
} from '../model/landing-content';
import {
  heroPlay,
  heroVideo,
  sourceLabel,
  THUMB_MISSING_W,
  thumbRetryUrl,
  thumbUrl,
  type LandingExample,
  type PlayTarget,
} from '../model/landing-example';
import {
  BAND_H,
  buildScene,
  DECK_THUMB_H,
  SOURCE_OPEN_SCENE,
  SOURCE_SCENE,
  wallTiles,
  YT_ICON_BOX_H,
  YT_ICON_BOX_W,
  type DeckState,
  type Phase,
  type Scene,
} from '../model/landing-scene';
import ytIconSrc from '../assets/yt_icon_red_digital.png';
import { GoogleButton } from './GoogleButton';
import { BrandLogo } from '@/shared/ui/brand-logo';

import { HeadButton } from './HeadButton';
import { LegalSheet } from './LegalSheet';

/*
 * One whole scene (background included) as a page of the landing. The current scene and its two
 * neighbours are pages of one track, so the neighbour comes along with the finger; a page that is
 * not the current one shows its scene's first moment and is inert.
 */
interface ScenePaneProps {
  /** The example, without videos whose thumbnail cannot be loaded. */
  ex: LandingExample;
  onDead: (id: string) => void;
  s: Scene;
  ph: Phase;
  live: boolean;
  /** The current page: reachable, measured, its animations running. */
  main: boolean;
  deck: DeckState;
  di: number;
  cardH: number;
  colStyle: CSSProperties;
  domains: readonly string[];
  busy: boolean;
  cardRef: RefObject<HTMLDivElement>;
  sheetRef: RefObject<HTMLDivElement>;
  tapped: () => boolean;
  onHint: () => void;
  onBrand: () => void;
  onSource: (e: { stopPropagation: () => void }) => void;
  onStart: (from: 'header' | 'final' | 'add') => void;
  onPlay: (t: PlayTarget) => void;
}

const WALL_TILES = wallTiles();
const WALL_LINE2 = ['var(--lv-wall-line2-0)', 'var(--lv-wall-line2-1)', 'var(--lv-wall-line2-2)'];

function ScenePaneView({
  ex,
  onDead,
  s,
  ph,
  live,
  main,
  deck,
  di,
  cardH,
  colStyle,
  domains,
  busy,
  cardRef: mainCardRef,
  sheetRef: mainSheetRef,
  tapped,
  onHint,
  onBrand,
  onSource,
  onStart,
  onPlay,
}: ScenePaneProps): JSX.Element {
  const view = useMemo(
    () => buildScene(s, ph, live, deck, di, ex, cardH),
    [s, ph, live, deck, di, ex, cardH]
  );
  const hero = heroVideo(ex);
  const [heroSource, ...restSources] = ex.brief.sources;
  const cardRef = main ? mainCardRef : undefined;
  const sheetRef = main ? mainSheetRef : undefined;
  const T = view.T;
  const off = (o: number): true | undefined => (o ? undefined : true);
  const sheetOn = view.sheetOn;
  const tab = (on: boolean): number | undefined => (on ? undefined : -1);
  /** Test ids belong to the current page only. */
  const tid = (id: string): string | undefined => (main ? id : undefined);
  return (
    <>
      {/* background: light/dark fade, two glows, noise */}
      <div className="lv-fill lv-none" style={{ overflow: 'hidden' }}>
        <div className="lv-fill lv-bg-light" style={{ opacity: view.lt, transition: view.bgtr3 }} />
        <div className="lv-fill lv-bg-dark" style={{ opacity: view.dk, transition: view.bgtr3 }} />
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

      <div className="lv-fill">
        <div className="lv-col" style={colStyle}>
          {/* scene 1 blobs */}
          <div
            className="lv-blobs"
            aria-hidden="true"
            data-move={live && main ? '' : undefined}
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
            data-testid={tid('lv-wall')}
            style={{ opacity: view.wall.o, transition: view.wall.tr }}
          >
            <div className="lv-wall-tilt">
              <div className="lv-wall-strip" data-move={view.wall.anim && main ? '' : undefined}>
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
                  </div>
                ))}
              </div>
            </div>
            <div className="lv-wall-fog" />
          </div>

          {/* scenes 3-5: the solid ground of the attribution row (no plate around it) */}
          <div
            className="lv-ground"
            data-testid={tid('lv-ground-paper')}
            style={{
              top: view.ground.top,
              opacity: view.ground.paper,
              transition: view.ground.tr,
            }}
          />
          <div
            className="lv-ground"
            data-dark=""
            data-testid={tid('lv-ground-night')}
            style={{
              top: view.ground.nightTop,
              opacity: view.ground.night,
              transition: view.ground.tr,
            }}
          />

          {/* scenes 2 and 5 (after the tap): the hero card under the thumbnail (bar row, channel row) */}
          <div
            className="lv-band"
            data-testid={tid('lv-band')}
            aria-hidden={off(view.band.o)}
            style={{
              top: view.band.t,
              height: BAND_H + 'px',
              opacity: view.band.o,
              transition: view.band.tr,
            }}
          >
            <span className="lv-band-av">{hero.channel.slice(0, 1)}</span>
            <span className="lv-band-ch">{hero.channel}</span>
          </div>

          {/* scene 1 */}
          <div
            className="lv-t0"
            aria-hidden={off(T[0]!.o)}
            data-testid={tid('lv-text-0')}
            style={{ opacity: T[0]!.o, transform: T[0]!.t, transition: T[0]!.tr }}
          >
            <h1 className="lv-title">
              {S0_TITLE[0]}
              <br />
              {S0_TITLE[1]}
              <br />
              {S0_TITLE[2]}
            </h1>
            <p className="lv-text">{S0_BODY}</p>
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
              if (tapped()) onHint();
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
            data-testid={tid('lv-deck')}
            style={{ opacity: T[0]!.o, transform: T[0]!.t, transition: T[0]!.tr2 }}
          >
            {view.deck.map((d, i) => (
              <div
                key={i}
                className="lv-deck"
                data-testid={tid('lv-deck-card')}
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
                      <Thumb
                        key={u}
                        id={u}
                        className="lv-deck-thumb"
                        testId={tid('lv-thumb')}
                        onDead={onDead}
                      />
                    ))}
                    {d.yt ? (
                      <YouTubeIcon
                        live={s === 0 && d.thumbsOn}
                        testId={tid('lv-yt-deck')}
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
          <div
            className="lv-t1"
            aria-hidden={off(T[1]!.o)}
            data-testid={tid('lv-text-1')}
            style={{ opacity: T[1]!.o, transform: T[1]!.t, transition: T[1]!.tr }}
          >
            <h2 className="lv-title">{S1_TITLE}</h2>
            <p className="lv-text">{S1_BODY}</p>
          </div>

          {/* scene 3 */}
          <div
            className="lv-t2"
            aria-hidden={off(T[2]!.o)}
            data-testid={tid('lv-text-2')}
            style={{ opacity: T[2]!.o, transform: T[2]!.t, transition: T[2]!.tr }}
          >
            <h2 className="lv-title">
              {S2_TITLE[0]}
              <br />
              {S2_TITLE[1]}
            </h2>
            <p className="lv-text">{S2_BODY}</p>
          </div>

          {/* scenes 4, 5 (before / after the source tap) */}
          <div
            className="lv-tn"
            aria-hidden={off(T[3]!.o)}
            data-testid={tid('lv-text-3')}
            style={{ opacity: T[3]!.o, transform: T[3]!.t, transition: T[3]!.tr }}
          >
            <h2 className="lv-title">{S3_TITLE}</h2>
            <p className="lv-text">{S3_BODY}</p>
          </div>
          <div
            className="lv-tn"
            aria-hidden={off(T[4]!.o)}
            data-testid={tid('lv-text-4')}
            style={{ opacity: T[4]!.o, transform: T[4]!.t, transition: T[4]!.tr }}
          >
            <h2 className="lv-title">{S4_TITLE}</h2>
            <p className="lv-text">{S4_BODY}</p>
          </div>
          <div
            className="lv-tn"
            aria-hidden={off(T[5]!.o)}
            data-testid={tid('lv-text-5')}
            style={{ opacity: T[5]!.o, transform: T[5]!.t, transition: T[5]!.tr }}
          >
            <h2 className="lv-title">{S5_TITLE}</h2>
            <p className="lv-text">{S5_BODY}</p>
          </div>

          {/* scene 6 */}
          <div className="lv-t6" aria-hidden={off(T[6]!.o)} data-testid={tid('lv-text-6')}>
            <h2
              className="lv-title"
              style={{ opacity: T[6]!.o, transform: T[6]!.t, transition: T[6]!.tr2 }}
            >
              {S7_TITLE}
            </h2>
            <p
              className="lv-text"
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
            data-testid={tid('lv-card')}
            style={{
              opacity: view.card.o,
              transform: view.card.t,
              clipPath: view.card.clip,
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
                  data-testid={tid('lv-source')}
                  onClick={onSource}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onSource(e);
                  }}
                  style={{
                    textDecoration: view.card.deco,
                    backgroundColor: view.card.sbg,
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
            className="lv-scan"
            style={{ opacity: view.scan.o, transform: view.scan.t, transition: view.scan.tr }}
          >
            <div className="lv-scan-line" />
          </div>

          {view.cells.map((c) => {
            const link = c.hero && s === SOURCE_OPEN_SCENE;
            const Tag = c.hero ? 'button' : 'div';
            return (
              <Tag
                key={c.key}
                className="lv-cell"
                data-testid={tid(c.hero ? 'lv-hero' : 'lv-cell')}
                data-shown={c.o ? '' : undefined}
                aria-hidden={link ? undefined : true}
                {...(c.hero
                  ? {
                      type: 'button' as const,
                      tabIndex: link ? 0 : -1,
                      'aria-label': `${c.video.title} — ${ytPlayLabel(c.video.channel)}`,
                      onClick: () => {
                        if (link && tapped()) onPlay(heroPlay(ex));
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
                  <Thumb
                    id={c.video.id}
                    className="lv-thumb"
                    testId={tid('lv-thumb')}
                    onDead={onDead}
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
                    data-testid={c.hero ? tid('lv-hero-title') : undefined}
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
            <div className="lv-bar-done" style={{ width: view.bar.dl, transition: view.bar.dtr }} />
            <div className="lv-bar-knob" style={{ left: view.bar.dl, transition: view.bar.dtr }} />
            <div
              className="lv-bar-label"
              data-testid={tid('lv-bar-label')}
              style={{ opacity: view.bar.lo, transition: view.bar.ltr }}
            >
              {ex.heroTime}
            </div>
          </div>

          {/* YouTube attribution while thumbnails are visible (the last sheet carries its own) */}
          <div
            key={'credit-' + s}
            className="lv-credit"
            data-testid={tid('lv-credit')}
            data-icon={view.credit.play ? '' : undefined}
            data-in={view.credit.in ? '' : undefined}
            aria-hidden={view.credit.on ? undefined : true}
            style={{
              top: view.credit.top + 'px',
              right: view.credit.right + 'px',
              opacity: view.credit.on ? 1 : 0,
            }}
          >
            {view.credit.play ? <YouTubeIcon live={view.credit.on} testId={tid('lv-yt')} /> : null}
          </div>

          {/* scene 6: the last sheet */}
          <div
            ref={sheetRef}
            className="lv-sheet"
            data-testid={tid('lv-sheet')}
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
                <p className="lv-sheet-lead" data-testid={tid('lv-domains-lead')}>
                  {domainsLead(domains.length)}
                </p>
                <div className="lv-doms" data-testid={tid('lv-doms')}>
                  {domains.map((d) => (
                    <span key={d} className="lv-dom" data-testid={tid('lv-dom')}>
                      {d}
                    </span>
                  ))}
                  <button
                    type="button"
                    className="lv-add"
                    aria-label={ADD_LABEL}
                    data-testid={tid('lv-add')}
                    tabIndex={tab(sheetOn)}
                    onClick={() => onStart('add')}
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
              onPress={() => onStart('final')}
              testId={tid('lv-google-final')}
              unreachable={!sheetOn}
            />
            <div className="lv-footer">
              <LegalSheet doc="privacy" label={PRIVACY.label}>
                <button type="button" data-testid={tid('lv-privacy')} tabIndex={tab(sheetOn)}>
                  {PRIVACY.label}
                </button>
              </LegalSheet>
              <span>·</span>
              <LegalSheet doc="terms" label={TERMS.label}>
                <button type="button" data-testid={tid('lv-terms')} tabIndex={tab(sheetOn)}>
                  {TERMS.label}
                </button>
              </LegalSheet>
              <span>·</span>
              <span data-testid={tid('lv-sheet-credit')}>{YT_CREDIT}</span>
            </div>
          </div>
        </div>
      </div>
      <div className="lv-col lv-none" style={colStyle}>
        <div className="lv-head">
          <HeadButton
            label={BRAND}
            className="lv-brand"
            testId={tid('lv-brand')}
            dark={view.nv}
            onPress={onBrand}
          >
            <BrandLogo dark={view.nv} />
          </HeadButton>
          <HeadButton
            label={LOGIN_LABEL}
            className="lv-login"
            testId={tid('lv-login')}
            dark={view.nv}
            hidden={!view.lgO}
            onPress={() => onStart('header')}
            style={{
              color: view.hdr,
              opacity: view.lgO,
              transition: live ? `${view.bgtr2}, opacity .3s` : 'none',
            }}
          />
        </div>
      </div>
    </>
  );
}

export const ScenePane = memo(ScenePaneView);

/**
 * The official YouTube Icon beside the videos it marks as YouTube's: shown, never a link (James
 * 2026-11-26: on the landing nothing leaves for YouTube; the videos play here, in the embedded
 * player, which keeps its own YouTube links). The file is drawn whole and unaltered (its transparent
 * margin is the icon's clear space), at its own proportions, on the row's solid colour. Taps pass
 * through it to the scene.
 */
function YouTubeIcon({
  live,
  testId,
  bleedY = 0,
}: {
  /** Visible in the current scene. */
  live: boolean;
  testId: string | undefined;
  /** Negative vertical margin (px) so the file's transparent margin does not grow the row. */
  bleedY?: number;
}): JSX.Element {
  return (
    <span
      className="lv-yt"
      data-testid={testId}
      data-live={live ? '' : undefined}
      style={{ pointerEvents: 'none', margin: `${-bleedY}px 0` }}
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
    </span>
  );
}

/**
 * A YouTube thumbnail, unaltered: mqdefault, then hqdefault, then it reports the video as dead (the
 * page shows another evidence video instead). Nothing is drawn until a picture has loaded, so no
 * empty block is ever seen.
 */
function Thumb({
  id,
  className,
  testId,
  onDead,
}: {
  id: string;
  className: string;
  testId: string | undefined;
  onDead: (id: string) => void;
}): JSX.Element {
  const [tries, setTries] = useState({ id, n: 0 });
  const n = tries.id === id ? tries.n : 0;
  const next = (): void => {
    if (n === 0) setTries({ id, n: 1 });
    else {
      setTries({ id, n: 2 });
      onDead(id);
    }
  };
  return (
    <img
      className={className}
      data-testid={testId}
      data-dead={n > 1 ? '' : undefined}
      src={n === 0 ? thumbUrl(id) : thumbRetryUrl(id)}
      alt=""
      decoding="async"
      draggable={false}
      onError={next}
      onLoad={(e) => {
        const w = e.currentTarget.naturalWidth;
        if (w > 0 && w <= THUMB_MISSING_W) next();
      }}
    />
  );
}
