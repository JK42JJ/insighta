/*
 * Watch screen (/morning-cards?view=watch): pure helpers for the goal list, the goal chips from
 * today's server batches, the batch videos still to answer, the top bar and the meta line.
 * No React here, so all of it is unit tested.
 */
import { formatMinutes } from '@/features/morning-feed/insight-summary';
import type { FeedCard, FeedCell } from '@/features/morning-feed/MorningFeed';

/** A feed card plus its length in seconds (the meta line shows it in minutes). */
export type WatchVideo = FeedCard & { durationSec: number };

export type WatchVerdict = 'useful' | 'skip' | 'pass';

/** The centre cell ("오늘 전체") has no cards of its own and is not a goal. */
const CENTRE_DOM = -1;
const META_SEPARATOR = ' · ';

/** The 8 goals: the feed's cells without the centre cell, in feed order. */
export function goalCells(cells: readonly FeedCell[]): FeedCell[] {
  return cells.filter((c) => c.dom !== CENTRE_DOM);
}

/** The server's per-day count. Anything but a positive whole number is treated as missing. */
export function parseWatchDaily(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

/** One goal today, as GET /morning-feed/watch/today sends it. */
export interface WatchTodayCell {
  /** Videos in today's batch; null = no batch yet. */
  issued: number | null;
  /** Batch videos answered on this screen. */
  judged: number;
  /** Videos a new batch would get. */
  available: number;
}

/** Per goal cell label. */
export type WatchTodayMap = Readonly<Record<string, WatchTodayCell>>;

const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;

/** The server's per-goal map. Not an object, or any entry with a malformed field -> null. */
export function parseWatchTodayMap(value: unknown): WatchTodayMap | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const out: Record<string, WatchTodayCell> = {};
  for (const [cell, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw !== 'object' || raw === null) return null;
    const e = raw as Record<string, unknown>;
    const issued = e['issued'];
    const judged = e['judged'];
    const available = e['available'];
    if (!(issued === null || isCount(issued)) || !isCount(judged) || !isCount(available)) {
      return null;
    }
    out[cell] = { issued, judged, available };
  }
  return out;
}

export type GoalChipKind = 'open' | 'done' | 'none';

export interface GoalChipState {
  kind: GoalChipKind;
  /** Videos the CTA hands out now: unanswered batch videos, or a new batch's size. */
  count: number;
}

/**
 * A goal chip from today's state: no batch and no candidates -> 'none' (disabled, 오늘 영상 없음);
 * a batch whose videos are all answered -> 'done' (오늘은 끝, opens the insight); otherwise 'open'
 * with count = unanswered batch videos, or what a new batch would get. Unknown goal = 'none'.
 */
export function goalChipState(cell: WatchTodayCell | undefined): GoalChipState {
  if (!cell) return { kind: 'none', count: 0 };
  if (cell.issued === null) {
    return cell.available > 0
      ? { kind: 'open', count: cell.available }
      : { kind: 'none', count: 0 };
  }
  const left = Math.max(0, cell.issued - cell.judged);
  return left > 0 ? { kind: 'open', count: left } : { kind: 'done', count: 0 };
}

/** The goal's text under its chip: '오늘은 끝', '오늘 n편' or '오늘 영상 없음'. */
export function goalRowText(count: number, doneToday: boolean): string {
  if (doneToday) return '오늘은 끝';
  return count > 0 ? '오늘 ' + count + '편' : '오늘 영상 없음';
}

/** After a batch arrived: its size and answered count are now known for the goal. */
export function withBatch(
  today: WatchTodayMap,
  cell: string,
  issued: number,
  judged: number
): WatchTodayMap {
  return { ...today, [cell]: { issued, judged, available: 0 } };
}

/** One more batch video of `cell` answered in this visit. */
export function withOneJudged(today: WatchTodayMap, cell: string): WatchTodayMap {
  const e = today[cell];
  if (!e) return today;
  return { ...today, [cell]: { ...e, judged: e.judged + 1 } };
}

/**
 * The batch videos still to answer, in batch order, each with its index in the batch (the
 * judgment's shown_position). Videos without a video id or already answered are left out.
 */
export function unansweredInBatch<T extends Pick<FeedCard, 'videoId'>>(
  items: readonly T[],
  answered: ReadonlySet<string>
): Array<{ video: T; position: number }> {
  const out: Array<{ video: T; position: number }> = [];
  items.forEach((video, position) => {
    if (video.videoId && !answered.has(video.videoId)) out.push({ video, position });
  });
  return out;
}

export type SegmentState = 'done' | 'current' | 'rest';

/** Progress segments of the top bar: passed, the one on screen, the ones still to come. */
export function segmentStates(total: number, current: number): SegmentState[] {
  return Array.from({ length: Math.max(0, total) }, (_x, i) =>
    i < current ? 'done' : i === current ? 'current' : 'rest'
  );
}

/** 'n / N' with n counted from 1. */
export function counterText(index: number, total: number): string {
  return index + 1 + ' / ' + total;
}

/** '채널 · 11분 · 칸'. A part whose data is missing is left out, never filled in. */
export function metaLine(
  channel: string | undefined,
  durationSec: number | null | undefined,
  cellShort: string | undefined
): string {
  return [(channel ?? '').trim(), formatMinutes(durationSec), (cellShort ?? '').trim()]
    .filter((p) => p.length > 0)
    .join(META_SEPARATOR);
}
