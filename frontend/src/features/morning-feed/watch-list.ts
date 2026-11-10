/*
 * Watch screen (/morning-cards?view=watch): pure helpers for the goal list, today's videos of a
 * goal, the top bar and the meta line. No React here, so all of it is unit tested.
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

/**
 * Today's videos for a goal: the first `n` cards of that cell in feed order that have a video
 * and were not judged yet (judged = in this visit; the server already leaves out earlier ones).
 */
export function pickTodaysVideos<T extends Pick<FeedCard, 'cell' | 'videoId'>>(
  cards: readonly T[],
  cell: string,
  n: number,
  judgedIds: ReadonlySet<string> = new Set()
): T[] {
  if (!(n > 0)) return [];
  const out: T[] = [];
  for (const c of cards) {
    if (out.length >= n) break;
    if (c.cell !== cell || !c.videoId || judgedIds.has(c.videoId)) continue;
    out.push(c);
  }
  return out;
}

/** The server's per-day count. Anything but a positive whole number is treated as missing. */
export function parseWatchDaily(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
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
