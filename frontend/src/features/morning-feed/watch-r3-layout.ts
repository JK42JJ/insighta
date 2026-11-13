/*
 * Watch screen, design handoff "design_handoff_insighta_watch_v2" (수정 3): the heights of every
 * region and which info blocks fit, as pure functions (unit tested). Values are the README's
 * ("화면 높이 기준", "플레이어 위치 고정", Screens 1 · 4). The player height follows the width
 * (16:9) but never goes under 200 px: YouTube Required Minimum Functionality requires a 200×200
 * viewport (decision 2026-11-13: under 356 px wide the player is 200 high).
 */
import { formatMinutes } from '@/features/morning-feed/insight-summary';

export const HEADER_H = 48;
export const CHANNEL_ROW_H = 52;
export const LOAD_LINE_H = 3;
export const ICON_ROW_H = 56;
export const CARD_GAP_H = 8;
/** Below the gap band at least this much of the next card shows (prototype budget). */
export const NEXT_PEEK_H = 44;
/** Title block (top 10 + 42) and the bottom padding of the info area. */
export const FEED_TITLE_H = 52;
export const FEED_INFO_PAD_H = 10;
export const WHY_H = 80;
export const SUMMARY_H = 64;
export const CHECKS_H = 24;
export const POINTS_H = 80;
/** Immersive playback: title (8 + 46), progress (36), the next-video line (48) or preview (92). */
export const IMM_TITLE_H = 54;
export const IMM_PROGRESS_H = 36;
export const NEXT_LINE_H = 48;
export const NEXT_BIG_H = 92;
/** Table of contents: top 6 + label 16, then 44 per row, at most 4 rows. */
export const CHAPTER_HEAD_H = 22;
export const CHAPTER_ROW_H = 44;
export const CHAPTER_MAX_ROWS = 4;

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
  showPoints: boolean;
  /** Card height: fixed part + title + the blocks that went in + bottom padding. */
  height: number;
}

/**
 * Feed card info blocks, README "정보 블록": only blocks with data, in the order 고른 이유 →
 * 한 줄 요약 → 확인 항목 (inside the 고른 이유 band, so only with it) → 설명란 순서, until the
 * height runs out; the rest goes to 더 보기.
 */
export function feedBlocks(
  f: Frame,
  has: { why: boolean; summary: boolean; checks: boolean; points: boolean }
): FeedBlocks {
  const base = feedBaseHeight(f.playerH);
  const budget = f.vh - f.safeTop - f.safeBottom - HEADER_H - NEXT_PEEK_H - base;
  let used = FEED_TITLE_H + FEED_INFO_PAD_H;
  const fit = (h: number): boolean => {
    if (used + h > budget) return false;
    used += h;
    return true;
  };
  const showWhy = has.why && fit(WHY_H);
  const showSummary = has.summary && fit(SUMMARY_H);
  const showChecks = showWhy && has.checks && fit(CHECKS_H);
  const showPoints = has.points && fit(POINTS_H);
  return { showWhy, showSummary, showChecks, showPoints, height: base + used };
}

/** Immersive card height: the app area minus the safe areas and the header (594 / 715). */
export function immersiveHeight(f: Frame): number {
  return f.vh - f.safeTop - f.safeBottom - HEADER_H;
}

export interface ImmersiveBlocks {
  /** Table-of-contents rows shown (0 = no table of contents). */
  chapterRows: number;
  showWhy: boolean;
  /** The next-video line grows into the 92 px preview. */
  nextBig: boolean;
  showSummary: boolean;
}

/**
 * Immersive playback below the progress bar, README §4. With a table of contents: as many rows
 * as fit (at most 4). Without one (decision 4c): 고른 이유 → large next-video preview → 한 줄
 * 요약, each only with data and only while the height lasts.
 */
export function immersiveBlocks(
  f: Frame,
  has: { chapters: number; why: boolean; summary: boolean; next: boolean }
): ImmersiveBlocks {
  let free =
    immersiveHeight(f) -
    topBlockHeight(f.playerH) -
    IMM_TITLE_H -
    IMM_PROGRESS_H -
    ICON_ROW_H -
    NEXT_LINE_H;
  if (has.chapters > 0) {
    const rows = Math.min(
      has.chapters,
      CHAPTER_MAX_ROWS,
      Math.max(0, Math.floor((free - CHAPTER_HEAD_H) / CHAPTER_ROW_H))
    );
    if (rows > 0) return { chapterRows: rows, showWhy: false, nextBig: false, showSummary: false };
  }
  const fit = (h: number): boolean => {
    if (free < h) return false;
    free -= h;
    return true;
  };
  const showWhy = has.why && fit(WHY_H);
  const nextBig = has.next && fit(NEXT_BIG_H - NEXT_LINE_H);
  const showSummary = has.summary && fit(SUMMARY_H);
  return { chapterRows: 0, showWhy, nextBig, showSummary };
}

const SECONDS_IN_MINUTE = 60;
const PAD = 2;

/** Playback clock: '0:42', '12:05'. */
export function clockText(seconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return Math.floor(s / SECONDS_IN_MINUTE) + ':' + String(s % SECONDS_IN_MINUTE).padStart(PAD, '0');
}

const KST_OFFSET_MS = 9 * 3_600_000;

/** Upload day in KST: '11월 9일'. '' when the time is missing or invalid. */
export function uploadDayText(iso: string | undefined): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const k = new Date(t + KST_OFFSET_MS);
  return k.getUTCMonth() + 1 + '월 ' + k.getUTCDate() + '일';
}

/** Channel row right text: '6분 · 11월 9일'; a part without data is left out. */
export function channelMetaText(durationSec: number | null | undefined, iso?: string): string {
  return [formatMinutes(durationSec), uploadDayText(iso)].filter((p) => p.length > 0).join(' · ');
}

/** Ink Navy (README §5) as its token: the background when the thumbnail colour is unknown. */
export const AMBIENT_FALLBACK = 'var(--w3-navy)';
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** The server's colour when it is a '#rrggbb' value (data, not a style literal), else Ink Navy. */
export function ambientOrDefault(color: string | null | undefined): string {
  return color && HEX_COLOR.test(color) ? color : AMBIENT_FALLBACK;
}
