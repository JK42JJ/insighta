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
 *   - only the selected cells are produced (one per evidence video, 3..6; the design has six):
 *     the design's 14 other cells have opacity 0 in every scene (grid/feed), so they are never
 *     seen. With fewer than six, scene 3 centres a last tile row that is not full (four
 *     videos: 2x2) and its attribution row follows the tiles; scene 4/5's chips keep the design's left-aligned row.
 *   - the scene-6 tiles (`s7`, always off: `on7 = false`) and the line drawing (`ln`, opacity 0
 *     in every scene) are not produced; nothing visible depends on them.
 *   - YouTube Icon (plays inside the landing) next to every thumbnail group (YouTube API branding guidelines): in the
 *     front deck card after its thumbnails (s=0) and in the attribution row (s=1..5).
 *   - nothing is drawn over a thumbnail, at rest or in flight (James 2026-11-25): no play button;
 *     the play bar, dot and time label are a row below the thumbnail, in one hero card that is the
 *     same in scenes 2 and 5 (channel row with attribution included); the scan line runs behind the
 *     tiles; what would be over a moving thumbnail shows after it has arrived.
 *   - the attribution row has no plate of its own (James 2026-11-25): the ground under it is one
 *     solid colour instead (the hero card's white; `ground` in scenes 3, 4 and 5).
 *   - scenes 4/5: the brief card, the chips and the attribution row are one group placed in the
 *     free height by the card's laid-out height; the chips fill the content column.
 *   - the dots move up in the last scene so they do not cross the sheet.
 */

import {
  EXAMPLE_VIDEOS_MAX,
  heroFraction,
  heroVideo,
  heroPlay,
  LANDING_EXAMPLE,
  thumbUrl,
  type ExampleVideo,
  type LandingExample,
  type PlayTarget,
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

/** design: scene 5's dot runs this long (s) after the source opened. */
export const PLAY_RUN_S = 8;
/** The bar row shows this long (s) after its scene starts (the thumbnail's .6 s flight). */
export const BAR_IN_S = 0.65;

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

/** landing.css: the header's height; the dots' row (DOT_COUNT buttons of 15px, one column). */
const HEAD_H = 52;
/** The last scene's dots (centre, design px): halfway between the header and the sheet's top. */
export function dotsTopAbove(sheetH: number, stageH: number): number {
  return (HEAD_H + stageH - sheetH) / 2;
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
 * The YouTube Icon (YouTube API branding guidelines, brand.youtube/youtube-icon): the official
 * file yt_icon_red_digital.png, unaltered. The file carries the icon's clear space as transparent
 * margin (icon body 827x579 inside 1255x1075; the clear space is the triangle's width / height,
 * which the margin covers), so drawing the whole file keeps the clear space free.
 * Size: the icon body is YT_ICON_MARK_PX design px tall: 24 CSS px (the published digital minimum
 * "24dp") down to a stage scale of 0.96 (a 375px-wide screen).
 */
export const YT_ICON_FILE_W = 1255;
export const YT_ICON_FILE_H = 1075;
export const YT_ICON_MARK_FILE_H = 579;
export const YT_ICON_MARK_PX = 25;
/** .lv-deck-thumb height (landing.css): the deck's thumbnail row the icon sits in. */
export const DECK_THUMB_H = 36;
/** The drawn file (icon + clear space), design px, in the file's own proportions. */
export const YT_ICON_BOX_H = (YT_ICON_MARK_PX * YT_ICON_FILE_H) / YT_ICON_MARK_FILE_H;
export const YT_ICON_BOX_W = (YT_ICON_BOX_H * YT_ICON_FILE_W) / YT_ICON_FILE_H;

/*
 * The YouTube attribution per scene (design coordinates, right-aligned to the content edge).
 * Not drawn in the design except in the last sheet; its unused `yt` positions (s=2 472, s=5 368)
 * and colours are used where they exist; scene 2 (s=1) puts it on the channel band's row (the
 * design's 500 would touch the band's edge), scenes 1, 4 and 5 (s=0, 3, 4) take the free row under
 * the deck / chips.
 */
const CREDIT_TOP: Readonly<Partial<Record<Scene, number>>> = {
  0: 558,
  // 1, 5: in the hero card's channel row (creditTopIn); 2: under the tiles (card2CreditTop)
  // 3, 4: under the chips (readGroup)
};
/** The solid ground of scenes 3-5's attribution row starts this far above it (a soft edge). */
export const GROUND_EDGE = 28;
/** Scene 3's attribution row sits this far under the tiles' last row (design: 452 -> 458). */
const CREDIT_UNDER_TILES = 6;
/** Scenes whose attribution row carries the icon (s=0 has it in the deck card instead). */
const CREDIT_ICON: ReadonlySet<Scene> = new Set<Scene>([1, 2, 3, 4, 5]);
/** Right edge: the scene texts' (40, clear of the dots); in the hero card: its padding (28 + 16). */
const CREDIT_RIGHT = 40;
const CREDIT_RIGHT_BAND = 44;

const X = 28;
/** .lv-card top (landing.css). */
const CARD_TOP = 148;
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
/*
 * The hero card (scene 2 and scene 5 after the tap, identical in both): the thumbnail, then the
 * play bar in its own row below it, then the channel row with the attribution and the icon.
 * Nothing is drawn over a thumbnail (James 2026-11-25: only in its original look).
 */
const HERO_W = 334;
const HERO_H = 188;
const HERO_PAD = 16;
/** Thumbnail bottom -> bar row; the row's height (landing.css .lv-bar); bar row -> channel row. */
export const BAR_GAP = 10;
export const BAR_H = 16;
const CHANNEL_GAP = 2;
/** Channel row (landing.css .lv-band: height BAND_H, the part under the thumbnail's rounded end). */
const CHANNEL_H = 48;
const HERO_CARD_H = HERO_H + BAR_GAP + BAR_H + CHANNEL_GAP + CHANNEL_H;
/** The card is behind the whole thumbnail, so the thumbnail casts no shadow on it. */
export const BAND_H = HERO_CARD_H;
/** Room kept at the right end of the bar row for the time label. */
const BAR_LABEL_W = 58;
/** Scene 5: the hero card ends here (the Google button starts at 588 on a 650 stage). */
const S5_BOTTOM = 576;
/** Scene 5: the line from the brief card down to the video. */
export const CN_H = 18;
const H2: Box = { x: X, y: 300, w: HERO_W, h: HERO_H };
const MID: Box = { x: X, y: S5_BOTTOM - HERO_CARD_H, w: HERO_W, h: HERO_H };
const creditTopIn = (b: Box): number =>
  b.y + HERO_H + BAR_GAP + BAR_H + CHANNEL_GAP + (CHANNEL_H - YT_ICON_BOX_H) / 2;
/** Scene 5's brief card: under the text (two lines end at 120), above the line. */
const CARD_S5_TOP = 126;
const CARD_S5_BOTTOM = MID.y - CN_H;
const CARD_S5_SCALE = 0.78;
const CARD_S5_X = 30;
/** Scene 5's card: scale .78 (less when the brief is too long for the room), its bottom on the line. */
function cardS5(cardH: number): string {
  const room = CARD_S5_BOTTOM - CARD_S5_TOP;
  const k = cardH > 0 ? Math.min(CARD_S5_SCALE, room / cardH) : CARD_S5_SCALE;
  const y = cardH > 0 ? CARD_S5_BOTTOM - CARD_TOP - k * cardH : CARD_S5_TOP - CARD_TOP;
  const x = CARD_S5_X + ((CARD_S5_SCALE - k) * HERO_W) / 2;
  return `translate(${px(x)},${px(y)}) scale(${Math.round(k * 1000) / 1000})`;
}
const MINI: Box = { x: 115, y: 470, w: 160, h: 90 };
const grid = (i: number): Box => ({
  x: X + (i % 4) * 85,
  y: 222 + Math.floor(i / 4) * 50.4,
  w: 79,
  h: 44.4,
});
/** Scene 3's tiles: the design's grid (3 per row, 106x60 thumbnails). */
interface TileGrid {
  cols: number;
  dx: number;
  dy: number;
  w: number;
  /** Thumbnail height (16:9). */
  th: number;
}
const TILES: TileGrid = { cols: 3, dx: 114, dy: 104, w: 106, th: 60 };
/** Four videos: 2x2 over the same 334px column, so no tile is left alone in a row. */
const TILES_FOUR: TileGrid = { cols: 2, dx: 171, dy: 136, w: 163, th: 92 };
const FOUR_VIDEOS = 4;
/** Tiles to chips (s): narrow, then drop; chips that were hidden show after that. */
const CHIP_NARROW_S = 0.35;
const CHIP_DROP_S = 0.4;
const CHIPS_IN_S = 0.8;
const TILES_TOP = 262;
/** The channel name under a thumbnail: gap, and the tile's room for it (design 4, 26). */
const TILE_NAME_GAP = 4;
const TILE_NAME_ROOM = 26;
const tileGrid = (n: number): TileGrid => (n === FOUR_VIDEOS ? TILES_FOUR : TILES);
/** The k-th of n tiles; a last row that is not full is centred. */
const card2 = (k: number, n: number): Box => {
  const g = tileGrid(n);
  const row = Math.floor(k / g.cols);
  const inRow = Math.min(g.cols, n - row * g.cols);
  return {
    x: X + (k % g.cols) * g.dx + ((g.cols - inRow) * g.dx) / 2,
    y: TILES_TOP + row * g.dy,
    w: g.w,
    h: g.th + TILE_NAME_ROOM,
  };
};
/** Where scene 3's attribution row goes for n tiles (458 for the design's two rows). */
const card2CreditTop = (n: number): number => {
  const g = tileGrid(n);
  const rows = Math.ceil(n / g.cols);
  return TILES_TOP + (rows - 1) * g.dy + g.th + TILE_NAME_ROOM + CREDIT_UNDER_TILES;
};
/** Scenes 4/5: the chips share the content column (six: the design's 50x28.1). */
const CHIP_GAP = 6.8;
const chipW = (n: number): number => (HERO_W - (Math.max(n, 3) - 1) * CHIP_GAP) / Math.max(n, 3);
const chipH = (n: number): number => (chipW(n) * 9) / 16;
/** Scenes 4/5: the group's room: from the two text lines' end to above the Google button. */
const READ_TOP = 120;
const READ_BOTTOM = 582;
const CARD_TO_CHIPS = 20;
const CHIPS_TO_CREDIT = 4;
/** Share of the free height above the group (the text above it is closer than the button). */
const READ_ABOVE = 0.4;
/** The card's height until it is measured (two headline lines, three text lines). */
const CARD_H_NOMINAL = 202;
/** Where scenes 4/5 put the card, the chips and the attribution row. */
export function readGroup(
  cardH: number,
  n: number
): { card: number; chips: number; credit: number } {
  const ch = cardH > 0 ? cardH : CARD_H_NOMINAL;
  const below = CARD_TO_CHIPS + chipH(n) + CHIPS_TO_CREDIT + YT_ICON_BOX_H;
  const free = Math.max(0, READ_BOTTOM - READ_TOP - ch - below);
  const card = READ_TOP + free * READ_ABOVE;
  const chips = card + ch + CARD_TO_CHIPS;
  return { card, chips, credit: chips + chipH(n) + CHIPS_TO_CREDIT };
}
const chipAt = (k: number, n: number, top: number): Box => ({
  x: X + k * (chipW(n) + CHIP_GAP),
  y: top,
  w: chipW(n),
  h: chipH(n),
});
const px = (v: number): string => Math.round(v * 10) / 10 + 'px';

type Mode = 'grid' | 'card2' | 'chip' | 'big' | 'feed' | 'mini';
interface Surf {
  l: number;
  t: number;
  w: number;
  h: number;
  o: number;
  r: number;
}
const SURF: Record<Mode, (b: Box) => Surf> = {
  grid: (b) => ({ l: 0, t: 0, w: b.w, h: b.h, o: 1, r: 6 }),
  card2: (b) => ({ l: 0, t: 0, w: b.w, h: b.h - TILE_NAME_ROOM, o: 1, r: 8 }),
  chip: (b) => ({ l: 0, t: 0, w: b.w, h: b.h, o: 1, r: 0 }),
  big: () => ({ l: 0, t: 0, w: 334, h: 188, o: 1, r: 0 }),
  feed: (b) => ({ l: 0, t: 0, w: b.w, h: b.h, o: 1, r: 0 }),
  mini: () => ({ l: 0, t: 0, w: 160, h: 90, o: 1, r: 0 }),
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

/**
 * The videos in slot order: the hero first (slot 0 is the hero's place), then the others; at most
 * EXAMPLE_VIDEOS_MAX (the design's selected cells).
 */
export function slotVideos(ex: LandingExample = LANDING_EXAMPLE): ExampleVideo[] {
  const hero = heroVideo(ex);
  return [hero, ...ex.videos.filter((v) => v !== hero)].slice(0, EXAMPLE_VIDEOS_MAX);
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
  /** Its thumbnails are drawn: the card is in front and nothing is over it. */
  thumbsOn: boolean;
  thumbs: readonly string[];
  /** What the YouTube Icon after the thumbnails plays (their first video), or null without thumbnails. */
  yt: PlayTarget | null;
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
  z: number;
  nl: string;
  nt: string;
  nh: string;
  no: number;
  bo: number;
  tr: string;
  tr2: string;
  tr3: string;
  /** The channel name's transition. */
  trn: string;
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
    ltr: string;
  };
  band: { o: number; t: string; tr: string };
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
  /** The solid ground under scenes 3-5's attribution row (its top and colour per scene). */
  ground: { paper: number; night: number; top: string; nightTop: string; tr: string };
  cn: { t: string; s: string; tr: string };
  btm: { on: boolean; t: string; tr: string };
  dots: ReadonlyArray<{ h: string; c: string; tr: string }>;
  wall: { on: boolean; o: number; tr: string; anim: boolean };
  credit: {
    on: boolean;
    top: number;
    right: number;
    c: string;
    /** Fades in after the thumbnails' flight (not under reduced motion). */
    in: boolean;
    /** What the YouTube Icon in the row plays inside the landing, or null (no icon in this scene). */
    play: PlayTarget | null;
  };
}

const v = (name: string): string => `var(--lv-${name})`;

/** design build(s, ph, live, h, di), see the header for the decided differences. */
export function buildScene(
  s: Scene,
  ph: Phase,
  live: boolean,
  deckState: DeckState | null,
  di = 0,
  ex: LandingExample = LANDING_EXAMPLE,
  cardH = 0
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
  const read = readGroup(cardH, slots.length);
  const chip = (k: number): Box => chipAt(k, slots.length, read.chips);
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
      // covered by the other card (or a card sliding over it): not drawn
      thumbsOn: L || (!A && i === di && !(h && h.lv >= 0)),
      thumbs: i === 0 ? slots.slice(0, 3).map((x) => thumbUrl(x.id)) : [],
      yt: i === 0 ? { video: slots[0]!, start: 0 } : null,
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

  const cells: Cell[] = SEL_CELLS.slice(0, slots.length).map((i, k): Cell => {
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
        b = card2(0, slots.length);
      } else if (s === 3 || s === 4) {
        mode = 'chip';
        b = chip(0);
      } else if (s === 6) {
        mode = 'mini';
        b = MINI;
      } else {
        mode = 'big';
        b = s === 0 ? H2 : MID;
      }
      o = s === 0 || s === 7 ? 0 : 1;
      // what it replaces (deck, last sheet) is gone before it shows
      dl = 0.2;
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
      const c2 = card2(k, slots.length);
      b = ph >= 2 || !live ? c2 : { ...c2, y: c2.y + 26 };
      o = ph >= 2 || !live ? 1 : 0;
      dl = k * 0.07;
    } else if (s === 3 || s === 4) {
      mode = 'chip';
      b = chip(k);
      o = 1;
      dl = CHIPS_IN_S;
    } else if (s === 5) {
      mode = 'chip';
      b = chip(k);
    }
    let bg = v('clear');
    let fg = v('ink');
    let sh = 'none';
    let rad = '6px';
    if (mode === 'card2') rad = '8px';
    if (mode === 'chip') {
      fg = v('paper');
      rad = '5px';
      sh = v('sh-chip');
      // decided: the others keep full opacity (design .35); the hero is marked by outline + shadow
      if (s === 4 && hero) {
        sh = v('sh-chip-hero');
      }
    }
    if (mode === 'big') {
      bg = v('white');
      // its shadow is the hero card's (it would fall on the card's own rows)
      sh = 'none';
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
    // tiles -> chips: first narrow into their chip's column, then drop, so no thumbnail flies over
    // another; otherwise the design's one move
    const toChips = mode === 'chip' && o > 0;
    const move = (p: string): string =>
      !toChips
        ? `${p} .6s ${EASE}`
        : p === 'top'
          ? `${p} ${CHIP_DROP_S}s ${CHIP_NARROW_S}s ${EASE}`
          : `${p} ${CHIP_NARROW_S}s ${EASE}`;
    const box = ['left', 'top', 'width', 'height', 'border-radius'].map(move).join(', ');
    // a hidden cell is gone at once: the hero may fly over its place
    const fade = o ? `opacity .45s ${dl}s` : hero ? 'opacity .15s' : 'opacity 0s';
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
      fg,
      sh,
      rad,
      sl: px(sf.l),
      st: px(sf.t),
      sw: px(sf.w),
      sh2: px(sf.h),
      so: sf.o,
      sr: px(sf.r),
      z: hero ? 2 : 1,
      ssh: mode === 'card2' ? v('sh-card2') : 'none',
      ov: mode === 'card2' ? 'visible' : 'hidden',
      nl: px(nm[0]),
      nt: px(mode === 'card2' ? sf.h + TILE_NAME_GAP : nm[1]),
      nh: px(nm[2]),
      no: nm[3],
      bo: mode === 'big' ? 1 : 0,
      tr: T(
        mode === 'feed' && ph >= 1
          ? `top 6s cubic-bezier(.3,0,.4,1), ${fade}, background-color .5s`
          : `${box}, ${fade}, background-color .5s, box-shadow .5s, color .5s`
      ),
      tr2: T(`${box}, opacity .3s`),
      // the name never crosses its thumbnail: out at once, in when the tile has arrived
      trn: T(nm[3] ? 'opacity .3s .6s' : 'opacity 0s'),
      tr3: T(mode === 'big' ? 'opacity .35s .3s' : 'opacity .15s'),
    };
  });

  const heroBox = s >= 4 ? MID : H2;
  // the dot is where the source is in the real video (the design drew .22), then moves on as the
  // video would in the 8 s it runs (the design moved it to .3)
  const at = heroFraction(ex);
  const pr =
    s === 1
      ? live && ph >= 1
        ? 1
        : 0
      : s === 5 && live
        ? ph === 0
          ? 0
          : ph === 1
            ? at
            : heroFraction(ex, PLAY_RUN_S)
        : at;
  const barOn = s === 1 || s === 5;
  const barW = HERO_W - HERO_PAD * 2 - BAR_LABEL_W;
  const dotTr = (t: string): string => T(`left ${t}, width ${t}`);
  const bar = {
    l: px(heroBox.x + HERO_PAD),
    t: px(heroBox.y + HERO_H + BAR_GAP),
    w: px(barW),
    o: barOn ? 1 : 0,
    dl: px(pr * barW),
    lo: s === 5 ? 1 : 0,
    // shown once the thumbnail is in its place, gone before it moves
    tr: T(barOn ? `opacity .25s ${BAR_IN_S}s` : 'opacity 0s'),
    dtr:
      s === 1 && ph >= 1
        ? dotTr(`3.6s cubic-bezier(.45,0,.55,1) ${BAR_IN_S}s`)
        : s === 5 && ph === 2
          ? dotTr(`${PLAY_RUN_S}s linear`)
          : s === 5 && ph === 1
            ? dotTr(`.55s ${EASE} ${BAR_IN_S}s`)
            : dotTr('0s'),
    ltr: T(s === 5 ? `opacity .35s ${BAR_IN_S}s` : 'opacity 0s'),
  };
  // the hero card under the thumbnail (bar row, channel row); behind the cells
  const band = {
    o: barOn ? 1 : 0,
    t: px(heroBox.y),
    tr: T(barOn ? `opacity .3s .5s, top .6s ${EASE}` : 'opacity .15s linear, top 0s .2s'),
  };

  const card = {
    o: s >= 3 && s <= 5 ? 1 : 0,
    pe: (s === 3 || s === 4 ? 'auto' : 'none') as 'auto' | 'none',
    t:
      s < 3
        ? `translateY(${px(read.card - CARD_TOP + 24)})`
        : s === 5
          ? cardS5(cardH)
          : s === 3 || s === 4
            ? `translateY(${px(read.card - CARD_TOP)})`
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
    t: px(MID.y - CN_H),
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
  const creditTop =
    s === 2
      ? card2CreditTop(slots.length)
      : s === 3 || s === 4
        ? read.credit
        : barOn
          ? creditTopIn(heroBox)
          : CREDIT_TOP[s];
  const credit = {
    on: creditTop !== undefined,
    top: creditTop ?? 0,
    right: barOn ? CREDIT_RIGHT_BAND : CREDIT_RIGHT,
    c: nv && !barOn ? v('credit-dark') : v('sub'),
    // the row is drawn anew per scene (IntroPage key) and fades in when the thumbnails rest
    in: live && creditTop !== undefined,
    // the groups play their first video (the hero); scene 5 is the hero from its source time
    play: CREDIT_ICON.has(s)
      ? s === SOURCE_OPEN_SCENE
        ? heroPlay(ex)
        : { video: heroVideo(ex), start: 0 }
      : null,
  };
  const ground = {
    paper: s === 2 ? 1 : 0,
    night: s === 3 || s === 4 ? 1 : 0,
    top: px(card2CreditTop(slots.length) - GROUND_EDGE),
    nightTop: px(read.credit - GROUND_EDGE),
    // solid before the row fades in
    tr: T('opacity .5s .1s ease'),
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
    band,
    card,
    scan,
    ground,
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
