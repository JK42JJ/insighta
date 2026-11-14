import {
  fetchMorningFeedHistory,
  fetchMorningPagesHome,
  fetchWatchToday,
  type FeedHistoryItem,
  type MorningHomePages,
} from '@/features/morning-cards/api';

/*
 * The watch screen's first two reads (today's state, 이전 주제), started together with the flag
 * check instead of after it (first open measured 2026-11-13: status → chunk → today/history ran
 * one after another). Taken once by MorningWatchLive; a later visit reads fresh.
 */
/**
 * [today's state, 이전 주제, home briefs]. today is null for a participant (decision 2026-11-14
 * user test): briefs are read first, and only the main account's experiment reads today's
 * videos, so a participant never asks a route that is closed to them.
 */
type WatchStart = [
  Awaited<ReturnType<typeof fetchWatchToday>> | null,
  FeedHistoryItem[],
  MorningHomePages | null,
];

/** The daily home's briefs are optional: unreadable = the experiment's input screen. */
function readHomePages(): Promise<MorningHomePages | null> {
  return fetchMorningPagesHome().catch((): null => null);
}

async function readStart(): Promise<WatchStart> {
  const pages = await readHomePages();
  if (pages && pages.experiment === false && pages.cells && pages.cells.length > 0) {
    return [null, [], pages];
  }
  const [today, history] = await Promise.all([
    fetchWatchToday(),
    // 이전 주제 is optional: when it cannot be read the section is simply not drawn
    fetchMorningFeedHistory().catch((): FeedHistoryItem[] => []),
  ]);
  return [today, history, pages];
}

let pending: Promise<WatchStart> | null = null;

export function prefetchWatchStart(): void {
  if (pending) return;
  pending = readStart();
  // a failed prefetch is read again by the screen, never left as an unhandled rejection
  pending.catch(() => {
    pending = null;
  });
}

/** The prefetched reads if they were started, else a fresh read. */
export function takeWatchStart(): Promise<WatchStart> {
  const p = pending;
  pending = null;
  return p ?? readStart();
}
