/*
 * Watch screen, design handoff "design_handoff_insighta_watch_v2" (수정 3): the heights of every
 * region and which info blocks fit, as pure functions (unit tested). Values are the README's
 * ("화면 높이 기준", "플레이어 위치 고정", Screens 1 · 4). The player height follows the width
 * (16:9) but never goes under 200 px: YouTube Required Minimum Functionality requires a 200×200
 * viewport (decision 2026-11-13: under 356 px wide the player is 200 high).
 */
import { formatMinutes } from '@/features/morning-feed/insight-summary';

/** README 수정 4: the header is 44 (the progress segments are gone; a counter only). */
export const HEADER_H = 44;
export const CHANNEL_ROW_H = 52;
/** The one line at the player's bottom edge: loading run, then playback progress. */
export const LOAD_LINE_H = 3;
export const ICON_ROW_H = 56;
export const CARD_GAP_H = 8;
/** Below the gap band at least this much of the next card shows. */
export const NEXT_PEEK_H = 50;
/** Title (top 8 + 40) and the views · length line (18): always shown. */
export const TITLE_META_H = 66;
export const WHY_H = 80;
export const SUMMARY_H = 64;
export const CHECKS_H = 24;
/** Feed: table of contents, top 12 + label 16 + 2 rows × 26. */
export const POINTS_H = 80;
export const FEED_POINT_ROWS = 2;
/** Immersive: the next-video line (48), grown to the preview (92), a second preview (+92). */
export const NEXT_LINE_H = 48;
export const NEXT_BIG_H = 92;
export const NEXT_SECOND_H = 92;
/** Immersive table of contents: top 6 + label 16, then 44 per row; only when 66 or more is left. */
export const CHAPTER_HEAD_H = 22;
export const CHAPTER_ROW_H = 44;
export const CHAPTER_MIN_H = 66;
/** Immersive line area: 3 (YouTube controls stay, 1b) or 64 (our controls, 1a — not built yet). */
export const IMM_LINE_H = LOAD_LINE_H;

const ASPECT_W = 16;
const ASPECT_H = 9;
/** YouTube Required Minimum Functionality: the player viewport is at least 200×200. */
export const PLAYER_MIN_H = 200;

/** Player height for the app width: width × 9/16, never under 200. */
export function playerHeight(width: number): number {
  return Math.max(PLAYER_MIN_H, Math.round((width * ASPECT_H) / ASPECT_W));
}

/** Header-to-line part shared by both modes: channel row + player + loading line. */
export function topBlockHeight(playerH: number): number {
  return CHANNEL_ROW_H + playerH + LOAD_LINE_H;
}

/** Fixed part of a feed card: channel row, player, line, icon row and the gap band (338 at 219). */
export function feedBaseHeight(playerH: number): number {
  return topBlockHeight(playerH) + ICON_ROW_H + CARD_GAP_H;
}

export interface Frame {
  /** App area height (dynamic viewport). */
  vh: number;
  safeTop: number;
  safeBottom: number;
  playerH: number;
}

export interface FeedBlocks {
  showWhy: boolean;
  showSummary: boolean;
  showChecks: boolean;
  /** Table-of-contents rows shown in the feed (0 or FEED_POINT_ROWS at most). */
  pointRows: number;
  /** Card height: fixed part + title/meta + the blocks that went in. */
  height: number;
}

/**
 * Feed card blocks, README 수정 4 §1: title + views/length (66) always; then 고른 이유 → 한 줄
 * 요약 → 확인 항목 (inside the 고른 이유 band, so only with it) → 설명란 순서 2 rows, each only
 * with data and only while the height lasts.
 */
export function feedBlocks(
  f: Frame,
  has: { why: boolean; summary: boolean; checks: boolean; points: number }
): FeedBlocks {
  const base = feedBaseHeight(f.playerH);
  const budget = f.vh - f.safeTop - f.safeBottom - HEADER_H - NEXT_PEEK_H - base;
  let used = TITLE_META_H;
  const fit = (h: number): boolean => {
    if (used + h > budget) return false;
    used += h;
    return true;
  };
  const showWhy = has.why && fit(WHY_H);
  const showSummary = has.summary && fit(SUMMARY_H);
  const showChecks = showWhy && has.checks && fit(CHECKS_H);
  const pointRows = has.points > 0 && fit(POINTS_H) ? Math.min(has.points, FEED_POINT_ROWS) : 0;
  return { showWhy, showSummary, showChecks, pointRows, height: base + used };
}

/** Immersive card height: the app area minus the safe areas and the header (598 / 719). */
export function immersiveHeight(f: Frame): number {
  return f.vh - f.safeTop - f.safeBottom - HEADER_H;
}

export interface ImmersiveBlocks {
  showWhy: boolean;
  /** The next-video line grows into the 92 px preview. */
  nextBig: boolean;
  showSummary: boolean;
  /** A second preview (the video after next) under the first. */
  nextSecond: boolean;
  /** Table-of-contents rows shown (0 = none). */
  chapterRows: number;
}

/**
 * Immersive playback, README 수정 4 §2: title + views/length (66), the icon row (56) and the
 * next-video line (48) are fixed; the rest is filled in this order while it lasts: 고른 이유 →
 * next preview (+44) → 한 줄 요약 → second preview (+92) → 설명란 순서 (22 + 44 per row).
 */
export function immersiveBlocks(
  f: Frame,
  has: { why: boolean; summary: boolean; next: boolean; afterNext: boolean; chapters: number }
): ImmersiveBlocks {
  let free =
    immersiveHeight(f) -
    CHANNEL_ROW_H -
    f.playerH -
    IMM_LINE_H -
    TITLE_META_H -
    ICON_ROW_H -
    NEXT_LINE_H;
  const fit = (h: number): boolean => {
    if (free < h) return false;
    free -= h;
    return true;
  };
  const showWhy = has.why && fit(WHY_H);
  const nextBig = has.next && fit(NEXT_BIG_H - NEXT_LINE_H);
  const showSummary = has.summary && fit(SUMMARY_H);
  const nextSecond = nextBig && has.afterNext && fit(NEXT_SECOND_H);
  const chapterRows =
    has.chapters > 0 && free >= CHAPTER_MIN_H
      ? Math.min(has.chapters, Math.floor((free - CHAPTER_HEAD_H) / CHAPTER_ROW_H))
      : 0;
  return { showWhy, nextBig, showSummary, nextSecond, chapterRows };
}

const SECONDS_IN_MINUTE = 60;
const PAD = 2;

/** Playback clock: '0:42', '12:05'. */
export function clockText(seconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return Math.floor(s / SECONDS_IN_MINUTE) + ':' + String(s % SECONDS_IN_MINUTE).padStart(PAD, '0');
}

/** The views · length line under the title: '조회수 1.2만회 · 6분'; a part without data is left out. */
export function viewsLengthText(viewsText: string, durationSec: number | null | undefined): string {
  return [viewsText, formatMinutes(durationSec)].filter((p) => p.length > 0).join(' · ');
}

/** The player's bottom edge in the immersive sheet position (README §5): safe top + header + top block. */
export function sheetTop(f: Frame): number {
  return f.safeTop + HEADER_H + topBlockHeight(f.playerH);
}

/** Ink Navy (README §5) as its token: the background when the thumbnail colour is unknown. */
export const AMBIENT_FALLBACK = 'var(--w3-navy)';
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** The server's colour when it is a '#rrggbb' value (data, not a style literal), else Ink Navy. */
export function ambientOrDefault(color: string | null | undefined): string {
  return color && HEX_COLOR.test(color) ? color : AMBIENT_FALLBACK;
}
