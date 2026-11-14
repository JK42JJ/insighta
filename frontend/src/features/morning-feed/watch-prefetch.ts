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
type WatchStart = [
  Awaited<ReturnType<typeof fetchWatchToday>>,
  FeedHistoryItem[],
  MorningHomePages | null,
];

/** The daily home's pages are optional: unreadable = the current input screen. */
function readHomePages(): Promise<MorningHomePages | null> {
  return fetchMorningPagesHome().catch((): null => null);
}

let pending: Promise<WatchStart> | null = null;

export function prefetchWatchStart(): void {
  if (pending) return;
  pending = Promise.all([
    fetchWatchToday(),
    // 이전 주제 is optional: when it cannot be read the section is simply not drawn
    fetchMorningFeedHistory().catch((): FeedHistoryItem[] => []),
    readHomePages(),
  ]);
  // a failed prefetch is read again by the screen, never left as an unhandled rejection
  pending.catch(() => {
    pending = null;
  });
}

/** The prefetched reads if they were started, else a fresh read. */
export function takeWatchStart(): Promise<WatchStart> {
  const p = pending;
  pending = null;
  if (p) return p;
  return Promise.all([
    fetchWatchToday(),
    fetchMorningFeedHistory().catch((): FeedHistoryItem[] => []),
    readHomePages(),
  ]);
}
