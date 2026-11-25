/*
 * The note "문장을 누르면 근거 영상이 나와요" (order 2026-11-25 B5): once per device, on the first
 * brief that is opened. A blocked storage shows it once per visit.
 */

export const SENTENCE_HINT = '문장을 누르면 근거 영상이 나와요';
/** How long it stays when nothing is tapped. */
export const SENTENCE_HINT_MS = 6000;
const SEEN_KEY = 'mf_sentence_hint_seen';

let seenNow = false;

export function sentenceHintSeen(): boolean {
  if (seenNow) return true;
  try {
    return window.localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function markSentenceHintSeen(): void {
  seenNow = true;
  try {
    window.localStorage.setItem(SEEN_KEY, '1');
  } catch {
    /* storage blocked: once per visit */
  }
}
