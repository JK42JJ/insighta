/*
 * Landing v4 scene state ("Insighta Intro v4.dc.html", 2026-11-24): a port of the design's build()
 * with its constants, positions, timings and easings copied as written. Scene `s` is 0..7 (6 is
 * never reached: the swipe order is SEQ), phase `ph` 0..2 runs the entrance inside a scene,
 * `live` is false under reduced motion (then every transition is 'none', as the design's rm path).
 *
 * Colours are CSS tokens (landing.css, `.lv`), never literals here.
 *
 * Differences from build(), all decided (2026-11-24):
 *   - scene 5 (s=4): the non-hero chips stay at full opacity (YouTube thumbnails unaltered);
 *     the hero chip is marked by its outline and shadow only.
 *   - only the six selected cells are produced: the design's 14 other cells have opacity 0 in
 *     every scene (grid/feed), so they are never seen.
 *   - the scene-6 tiles (`s7`, always off: `on7 = false`) and the line drawing (`ln`, opacity 0
 *     in every scene) are not produced; nothing visible depends on them.
 */

import {
  heroVideo,
  LANDING_EXAMPLE,
  thumbUrl,
  type ExampleVideo,
  type LandingExample,
} from './landing-example';

export type Phase = 0 | 1 | 2;
/** Scene ids; 6 exists in the design's state function but is not in the swipe order. */
export type Scene = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** design: swipe order, dot of each scene, scene of each dot. */
export const SEQ: readonly Scene[] = [0, 1, 2, 3, 4, 5, 7];
export const DOT: readonly number[] = [0, 1, 2, 3, 4, 4, 5, 5];
export const DOTGO: readonly Scene[] = [0, 1, 2, 3, 4, 7];
export const DOT_COUNT = DOTGO.length;
export const FIRST_SCENE: Scene = 0;
export const LAST_SCENE: Scene = 7;
/** design: the scene whose source tap leads to the next one, and that next one. */
export const SOURCE_SCENE: Scene = 4;
export const SOURCE_OPEN_SCENE: Scene = 5;

/** design: one swipe = one scene; further swipes within this are ignored. */
export const STEP_LOCK_MS = 700;
/** design: a drag longer than this (px) is a swipe. */
export const SWIPE_MIN_PX = 36;
/** design: a wheel delta larger than this is a step. */
export const WHEEL_MIN = 12;
/** design: rubber band: drag factor at an end / elsewhere, and the cap (px). */
export const PULL_EDGE = 0.12;
export const PULL_MID = 0.22;
export const PULL_MAX_PX = 48;
/** design: phase timers after a scene change (ms): scene 3 waits longer for its tiles. */
export const PH1_MS = 120;
export const PH2_MS = 1350;
export const PH1_MS_S2 = 820;
export const PH2_MS_S2 = 2050;
/** design: first phase change after mount. */
export const MOUNT_PH_MS = 300;
/** design: deck rotation in scene 1: every CYCLE, card leaves for LEAVE, then re-arrives after ARRIVE. */
export const DECK_CYCLE_MS = 3800;
export const DECK_LEAVE_MS = 640;
export const DECK_ARRIVE_MS = 40;

/** design: the stage. */
export const STAGE_W = 390;
export const STAGE_H = 650;

export const EASE = 'cubic-bezier(.32,.72,0,1)';
export const EASE_BACK = `transform .5s ${EASE}`;

export interface Fit {
  /** Stage scale (design px -> screen px). */
  k: number;
  /** Stage size in design px. */
  w: number;
  h: number;
}

/**
 * Fits the 390x650 stage to the screen: scaled to the width, but never more than the visible
 * height allows (650 design px always fit); the height is stretched (top-anchored parts keep their
 * design positions, bottom-anchored ones stay at the bottom).
 */
export function fitStage(vw: number, vh: number): Fit {
  const k = Math.min(vw / STAGE_W, vh / STAGE_H);
  return { k, w: vw / k, h: vh / k };
}

/** The scene after `s` going `d` (+1 next, -1 previous), or null at an end. */
export function nextScene(s: Scene, d: 1 | -1): Scene | null {
  const j = SEQ.indexOf(s) + d;
  return j >= 0 && j < SEQ.length ? SEQ[j]! : null;
}

/** Event value of the dot a scene shows ("s1".."s6"). */
export function sceneEventValue(s: Scene): string {
  return `s${(DOT[s] ?? 0) + 1}`;
}

/*
 * The YouTube attribution per scene (design coordinates, right-aligned to the content edge).
 * Not drawn in the design except in the last sheet; its unused `yt` positions (s=2 472, s=5 368)
 * and colours are used where they exist; scene 2 (s=1) puts it on the channel band's row (the
 * design's 500 would touch the band's edge), scenes 1, 4 and 5 (s=0, 3, 4) take the free row under
 * the deck / chips.
 */
const CREDIT_TOP: Readonly<Partial<Record<Scene, number>>> = {
  0: 558,
  1: 512,
  2: 472,
  3: 498,
  4: 498,
  5: 368,
};
/** Right edge: the scene texts' (40, clear of the dots); scene 2: inside the band's padding (28 + 16). */
const CREDIT_RIGHT = 40;
const CREDIT_RIGHT_BAND = 44;

const X = 28;
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
const H2: Box = { x: 28, y: 300, w: 334, h: 188 };
const BIG: Box = { x: 28, y: 230, w: 334, h: 262 };
const MID: Box = { x: 28, y: 392, w: 334, h: 188 };
const MINI: Box = { x: 115, y: 470, w: 160, h: 90 };
const grid = (i: number): Box => ({
  x: X + (i % 4) * 85,
  y: 222 + Math.floor(i / 4) * 50.4,
  w: 79,
  h: 44.4,
});
const card2 = (k: number): Box => ({
  x: X + (k % 3) * 114,
  y: 262 + Math.floor(k / 3) * 104,
  w: 106,
  h: 86,
});
const chip = (k: number): Box => ({ x: X + k * 56.8, y: 462, w: 50, h: 28.1 });
const px = (v: number): string => Math.round(v * 10) / 10 + 'px';

type Mode = 'grid' | 'card2' | 'chip' | 'big' | 'feed' | 'mini';
interface Surf {
  l: number;
  t: number;
  w: number;
  h: number;
  o: number;
  r: number;
  pl: string;
}
const SURF: Record<Mode, (b: Box) => Surf> = {
  grid: (b) => ({ l: 0, t: 0, w: b.w, h: b.h, o: 1, r: 6, pl: 'scale(.34)' }),
  card2: () => ({ l: 0, t: 0, w: 106, h: 60, o: 1, r: 8, pl: 'scale(.3)' }),
  chip: (b) => ({ l: 0, t: 0, w: b.w, h: b.h, o: 1, r: 0, pl: 'scale(0)' }),
  big: () => ({ l: 0, t: 0, w: 334, h: 188, o: 1, r: 0, pl: 'none' }),
  feed: (b) => ({ l: 0, t: 0, w: b.w, h: b.h, o: 1, r: 0, pl: 'scale(.3)' }),
  mini: () => ({ l: 0, t: 0, w: 160, h: 90, o: 1, r: 0, pl: 'scale(.5)' }),
};
/** design: name label left, top, height, opacity per mode. */
const NAME: Record<Mode, readonly [number, number, number, number]> = {
  feed: [0, 0, 0, 0],
  grid: [0, 0, 44, 0],
  card2: [2, 64, 22, 1],
  chip: [10, 0, 28, 0],
  big: [0, 0, 0, 0],
  mini: [10, 0, 28, 0],
};
/** design: grid index of the k-th selected video (SEL); index 1 is the hero. */
const SEL_CELLS: readonly number[] = [1, 6, 8, 11, 13, 18];
const HERO_CELL = 1;

/** The six videos in slot order: the hero first (slot 0 is the hero's place), then the others. */
export function slotVideos(ex: LandingExample = LANDING_EXAMPLE): ExampleVideo[] {
  const hero = heroVideo(ex);
  return [hero, ...ex.videos.filter((v) => v !== hero)];
}

export interface DeckState {
  /** Card leaving (index) or -1. */
  lv: number;
  /** Card re-arriving (index) or -1. */
  ar: number;
}

export interface TextAnim {
  o: number;
  t: string;
  tr: string;
  tr2: string;
  tr3: string;
}

export interface DeckCard {
  dom: string;
  h: string;
  thumbs: readonly string[];
  z: number;
  o: number;
  t: string;
  tr: string;
  tto: string;
}

export interface Cell {
  key: number;
  hero: boolean;
  video: ExampleVideo;
  img: string;
  l: string;
  t: string;
  w: string;
  h: string;
  o: number;
  bg: string;
  bd: string;
  fg: string;
  sh: string;
  rad: string;
  sl: string;
  st: string;
  sw: string;
  sh2: string;
  so: number;
  sr: string;
  ssh: string;
  ov: 'visible' | 'hidden';
  pl: string;
  z: number;
  nl: string;
  nt: string;
  nh: string;
  no: number;
  bo: number;
  tr: string;
  tr2: string;
  tr3: string;
}

export interface SceneView {
  s: Scene;
  nv: boolean;
  lt: number;
  dk: number;
  bgtr3: string;
  grtr: string;
  gtr: string;
  g1: string;
  g2: string;
  g1c: string;
  g2c: string;
  gr: number;
  grb: 'overlay' | 'multiply';
  hdr: string;
  bgtr2: string;
  T: readonly TextAnim[];
  sheetOn: boolean;
  lgO: number;
  deck: readonly DeckCard[];
  cells: readonly Cell[];
  bar: {
    l: string;
    t: string;
    w: string;
    o: number;
    dl: string;
    lo: number;
    tr: string;
    dtr: string;
    lp: string;
    ltr: string;
  };
  card: {
    o: number;
    pe: 'auto' | 'none';
    t: string;
    tr: string;
    dim: number;
    deco: 'underline' | 'none';
    sbg: string;
    st: string;
  };
  scan: { o: number; t: string; tr: string };
  cn: { t: string; s: string; tr: string };
  btm: { on: boolean; t: string; tr: string };
  dots: ReadonlyArray<{ h: string; c: string; tr: string }>;
  wall: { on: boolean; o: number; tr: string; anim: boolean };
  credit: { on: boolean; top: number; right: number; c: string; tr: string };
}

const v = (name: string): string => `var(--lv-${name})`;

/** design build(s, ph, live, h, di), see the header for the decided differences. */
export function buildScene(
  s: Scene,
  ph: Phase,
  live: boolean,
  deckState: DeckState | null,
  di = 0,
  ex: LandingExample = LANDING_EXAMPLE
): SceneView {
  const nv = s >= 3 && s <= 5;
  const T = (t: string): string => (live ? t : 'none');
  const GL = (
    [
      [330, 120, 40, 560],
      [340, 200, 30, 600],
      [60, 150, 340, 620],
      [195, 250, 360, 640],
      [195, 300, 20, 620],
      [195, 260, 380, 120],
      [195, 260, 380, 120],
      [320, 90, 50, 600],
    ] as const
  )[s];

  const texts: TextAnim[] = [];
  for (let i = 0; i < 8; i++) {
    const on = i === 6 ? s === 7 : s === i;
    const lv = 'opacity .15s linear, transform 0s .15s';
    const inn = (d: number): string => `opacity .45s ${d}s ease-out, transform .6s ${d}s ${EASE}`;
    texts.push({
      o: on ? 1 : 0,
      t: on ? 'none' : 'translateY(12px)',
      tr: T(on ? inn(0.15) : lv),
      tr2: T(on ? inn(0.3) : lv),
      tr3: T(on ? inn(0.45) : lv),
    });
  }

  const slots = slotVideos(ex);
  const DECK: ReadonlyArray<readonly [string, string]> = [
    [ex.brief.domain, ex.brief.headline],
    [ex.deck2.domain, ex.deck2.headline],
    ['', ''],
  ];
  const h = deckState;
  const deck = DECK.map(([dom, head], i): DeckCard => {
    const fr = h && h.lv >= 0 ? (h.lv + 1) % 2 : di;
    const k = i === 2 ? 2 : i === fr ? 0 : 1;
    const L = !!h && h.lv === i;
    const A = !!h && h.ar === i;
    return {
      dom,
      h: head,
      thumbs: i === 0 ? slots.slice(0, 3).map((x) => thumbUrl(x.id)) : [],
      z: L ? 4 : 3 - k,
      o: A ? 0 : 1,
      tto: T(k === 0 ? 'opacity .5s .15s ease' : 'opacity .3s ease'),
      t: L
        ? 'translate(-128%, 18px) rotate(-9deg)'
        : `translateY(${-k * 14}px) scale(${1 - k * 0.05})`,
      tr: T(
        L
          ? 'transform .62s cubic-bezier(.55,0,.75,.35)'
          : A
            ? 'transform 0s, opacity 0s'
            : `transform .7s .08s ${EASE}, opacity .5s ease`
      ),
    };
  });

  const cells: Cell[] = SEL_CELLS.map((i, k): Cell => {
    const hero = i === HERO_CELL;
    let mode: Mode = 'grid';
    let b = grid(i);
    let o = 0;
    let dl = 0;
    if (hero) {
      if (s === 1) {
        mode = 'big';
        b = H2;
      } else if (s === 5) {
        mode = 'big';
        b = MID;
      } else if (s === 2) {
        mode = 'card2';
        b = card2(0);
      } else if (s === 3 || s === 4) {
        mode = 'chip';
        b = chip(0);
      } else if (s === 6) {
        mode = 'mini';
        b = MINI;
      } else {
        mode = 'big';
        b = BIG;
      }
      o = s === 0 || s === 7 ? 0 : 1;
    } else if (s === 1) {
      const j = i - 1;
      const col = j % 3;
      const row = Math.floor(j / 3);
      mode = 'feed';
      o = 0;
      const drift = ph >= 1 && live ? [50, 90, 70][col]! : 0;
      b = {
        x: 18 + col * 120 + [0, -6, 4][row % 3]!,
        y: 214 + [0, 28, 12][col]! + row * 68 - drift,
        w: 112,
        h: 63,
      };
    } else if (s === 2) {
      mode = 'card2';
      const c2 = card2(k);
      b = ph >= 2 || !live ? c2 : { ...c2, y: c2.y + 26 };
      o = ph >= 2 || !live ? 1 : 0;
      dl = k * 0.07;
    } else if (s === 3 || s === 4) {
      mode = 'chip';
      b = chip(k);
      o = 1;
    }
    let bg = v('clear');
    let bd = v('clear');
    let fg = v('ink');
    let sh = 'none';
    let rad = '6px';
    if (mode === 'card2') rad = '8px';
    if (mode === 'chip') {
      bd = v('chip-line');
      fg = v('paper');
      rad = '5px';
      sh = v('sh-chip');
      // decided: the others keep full opacity (design .35); the hero is marked by outline + shadow
      if (s === 4 && hero) {
        bd = v('paper');
        sh = v('sh-chip-hero');
      }
    }
    if (mode === 'big') {
      bg = v('white');
      sh = v('sh-big');
      rad = '18px';
    }
    if (mode === 'feed') {
      bg = v('white');
      sh = v('sh-feed');
      rad = '7px';
    }
    if (mode === 'mini') {
      bg = v('white');
      sh = v('sh-mini');
      rad = '12px';
    }
    const sf = SURF[mode](b);
    const nm = NAME[mode];
    const hasImg = mode !== 'feed';
    return {
      key: i,
      hero,
      video: slots[k]!,
      img: thumbUrl(slots[k]!.id),
      l: px(b.x),
      t: px(b.y),
      w: px(b.w),
      h: px(b.h),
      o,
      bg,
      bd,
      fg,
      sh,
      rad,
      sl: px(sf.l),
      st: px(sf.t),
      sw: px(sf.w),
      sh2: px(sf.h),
      so: sf.o,
      sr: px(sf.r),
      pl: hasImg && mode !== 'big' ? 'scale(0)' : sf.pl,
      z: hero ? 2 : 1,
      ssh: mode === 'card2' ? v('sh-card2') : 'none',
      ov: mode === 'card2' ? 'visible' : 'hidden',
      nl: px(nm[0]),
      nt: px(nm[1]),
      nh: px(nm[2]),
      no: nm[3],
      bo: mode === 'big' ? 1 : 0,
      tr: T(
        mode === 'feed' && ph >= 1
          ? 'top 6s cubic-bezier(.3,0,.4,1), opacity .45s, background-color .5s'
          : `left .6s ${EASE}, top .6s ${EASE}, width .6s ${EASE}, height .6s ${EASE}, border-radius .6s ${EASE}, opacity .45s ${dl}s, background-color .5s, border-color .5s, box-shadow .5s, color .5s`
      ),
      tr2: T(
        `left .6s ${EASE}, top .6s ${EASE}, width .6s ${EASE}, height .6s ${EASE}, border-radius .6s ${EASE}, transform .6s ${EASE}, opacity .3s`
      ),
      tr3: T(mode === 'big' ? 'opacity .35s .3s' : 'opacity .15s'),
    };
  });

  const mini = s === 6;
  const bb =
    s === 1
      ? { x: H2.x + 16, y: H2.y + 188 - 24, w: H2.w - 32 }
      : s === 5
        ? { x: MID.x + 16, y: MID.y + 188 - 24, w: MID.w - 32 }
        : mini
          ? { x: MINI.x + 10, y: MINI.y + MINI.h - 20, w: MINI.w - 20 }
          : { x: BIG.x + 16, y: BIG.y + 188 - 24, w: BIG.w - 32 };
  const pr =
    s === 1
      ? live && ph >= 1
        ? 1
        : 0
      : s === 5 && live
        ? ph === 0
          ? 0
          : ph === 1
            ? 0.22
            : 0.3
        : 0.22;
  const barOn = s === 1 || s === 5 || s === 6;
  const bar = {
    l: px(bb.x),
    t: px(bb.y),
    w: px(bb.w),
    o: barOn ? 1 : 0,
    dl: px(pr * bb.w),
    lo: s === 5 ? 1 : 0,
    tr: T(
      `left .6s ${EASE}, top .6s ${EASE}, width .6s ${EASE}, opacity .3s ${barOn ? '.3s' : '0s'}`
    ),
    dtr: T(
      s === 1 && ph >= 1
        ? 'left 3.6s cubic-bezier(.45,0,.55,1), width 3.6s cubic-bezier(.45,0,.55,1)'
        : s === 5 && ph === 2
          ? 'left 8s linear, width 8s linear'
          : s === 5 && ph === 1
            ? `left .55s ${EASE}, width .55s ${EASE}`
            : `left .6s ${EASE}, width .6s ${EASE}`
    ),
    lp: px(0.22 * bb.w),
    ltr: T(s === 5 ? 'opacity .35s .6s' : 'opacity .15s'),
  };

  const card = {
    o: s >= 3 && s <= 5 ? 1 : 0,
    pe: (s === 3 || s === 4 ? 'auto' : 'none') as 'auto' | 'none',
    t:
      s < 3
        ? 'translateY(24px)'
        : s === 5
          ? 'translate(30px,-20px) scale(.82)'
          : s === 6 || s === 7
            ? 'translate(30px,78px) scale(.82)'
            : 'none',
    tr: T(`opacity ${s === 6 ? '.45s .2s' : s === 3 ? '.45s .1s' : '.3s'}, transform .6s ${EASE}`),
    dim: s === 4 || s === 5 ? 0.28 : 1,
    deco: (s === 4 || s === 5 ? 'underline' : 'none') as 'underline' | 'none',
    sbg: s === 4 || s === 5 ? v('src-on') : v('src-off'),
    st: s === 4 && ph === 1 && live ? 'scale(1.08)' : 'none',
  };

  const scan = {
    o: s === 2 && ph === 1 && live ? 1 : 0,
    t: s === 2 && ph >= 1 && live ? 'translateY(330px)' : 'none',
    tr: T(
      s === 2 && ph >= 1
        ? 'transform 1.1s cubic-bezier(.45,0,.55,1), opacity .25s'
        : 'opacity .25s, transform 0s .25s'
    ),
  };
  const cn = {
    t: '376px',
    s: s === 5 ? 'scaleY(1)' : 'scaleY(0)',
    tr: T(s === 5 ? `transform .3s .45s ${EASE}` : 'transform .15s'),
  };
  const btmOn = s >= 2 && s <= 5;
  const btm = {
    on: btmOn,
    t: btmOn ? 'none' : 'translateY(110%)',
    tr: T(`transform .5s ${EASE}, background-color .6s ease`),
  };
  const dots = Array.from({ length: DOT_COUNT }, (_x, i) => ({
    h: i === DOT[s] ? '16px' : '5px',
    c: i === DOT[s] ? (nv ? v('paper') : v('navy')) : nv ? v('dot-idle-dark') : v('dot-idle'),
    tr: T(`height .35s ${EASE}, background-color .6s`),
  }));
  const wallOn = s === 1 || s === 2;
  const wall = {
    on: wallOn,
    o: !wallOn ? 0 : s === 2 && ph >= 2 ? 0.32 : 0.7,
    tr: live ? (wallOn ? 'opacity .9s ease' : 'opacity .2s') : 'none',
    anim: live && wallOn,
  };
  const creditTop = CREDIT_TOP[s];
  const credit = {
    on: creditTop !== undefined,
    top: creditTop ?? 0,
    right: s === 1 ? CREDIT_RIGHT_BAND : CREDIT_RIGHT,
    c: nv ? v('credit-dark') : v('sub'),
    tr: T(creditTop !== undefined ? 'opacity .4s .5s' : 'opacity .15s'),
  };

  return {
    s,
    nv,
    lt: nv ? 0 : 1,
    dk: nv ? 1 : 0,
    bgtr3: T('opacity .6s ease'),
    grtr: T('opacity .8s ease'),
    gtr: T('transform 1.1s cubic-bezier(.4,0,.2,1)'),
    g1: `translate(${GL[0]}px,${GL[1]}px)`,
    g2: `translate(${GL[2]}px,${GL[3]}px)`,
    g1c: nv ? v('glow1-dark') : v('glow1'),
    g2c: nv ? v('glow2-dark') : v('glow2'),
    gr: nv ? 0.09 : s === 1 ? 0.075 : 0.045,
    grb: nv ? 'overlay' : 'multiply',
    hdr: nv ? v('paper') : v('navy'),
    bgtr2: T('color .6s ease'),
    T: texts,
    sheetOn: s === 7,
    lgO: s === 7 ? 0 : 1,
    deck,
    cells,
    bar,
    card,
    scan,
    cn,
    btm,
    dots,
    wall,
    credit,
  };
}

/** design: the drawn feed wall's tile colours (index into --lv-wall-N) and shapes. */
export const WALL_COLORS = 10;
export const WALL_ROWS = 16;
export const WALL_COLS = 4;
export interface WallTile {
  key: string;
  left: number;
  top: number;
  color: number;
  w1: number;
  w2: number;
  a2: number;
  r: number;
  size: number;
}
export function wallTiles(): WallTile[] {
  const tiles: WallTile[] = [];
  for (let rr = 0; rr < WALL_ROWS; rr++)
    for (let c = 0; c < WALL_COLS; c++) {
      const n = (rr % 8) * 4 + c;
      tiles.push({
        key: `${rr}-${c}`,
        left: c * 108,
        top: rr * 64,
        color: (n * 7 + 3) % WALL_COLORS,
        w1: [62, 78, 54, 70][n % 4]!,
        w2: [40, 28, 48][n % 3]!,
        a2: n % 3,
        r: [4, 22, 10][n % 3]!,
        size: [40, 52, 34][n % 3]!,
      });
    }
  return tiles;
}
