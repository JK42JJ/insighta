/**
 * Comment signals — COUNTS ONLY. Comment text is held in memory for counting
 * and is never stored, returned from commentSignalsForVideo, or logged.
 */
import {
  COMMENT_TOP_N,
  COMMENTS_DISABLED_REASON,
  NEGATIVE_COMMENT_WORDS,
  POSITIVE_COMMENT_WORDS,
  YT_API_BASE,
} from '@/config/measurement-record';
import type { CommentSignals, FetchFn } from './types';

const HTTP_FORBIDDEN = 403;

export interface WordLists {
  positive: readonly string[];
  negative: readonly string[];
}

export const DEFAULT_WORD_LISTS: WordLists = {
  positive: POSITIVE_COMMENT_WORDS,
  negative: NEGATIVE_COMMENT_WORDS,
};

/**
 * Number of comments containing at least one word of each list. Returns counts
 * only (no text).
 */
export function countCommentSignals(
  texts: readonly string[],
  words: WordLists = DEFAULT_WORD_LISTS
): { positive_count: number; negative_count: number; sampled: number } {
  let positive = 0;
  let negative = 0;
  for (const raw of texts) {
    const t = raw.toLowerCase();
    if (words.positive.some((w) => t.includes(w.toLowerCase()))) positive += 1;
    if (words.negative.some((w) => t.includes(w.toLowerCase()))) negative += 1;
  }
  return { positive_count: positive, negative_count: negative, sampled: texts.length };
}

export interface TopCommentsResult {
  /** In-memory only; callers must count and discard. */
  texts: string[];
  disabled: boolean;
}

interface CommentThreadsResponse {
  items?: Array<{
    snippet?: { topLevelComment?: { snippet?: { textDisplay?: string; textOriginal?: string } } };
  }>;
  error?: { errors?: Array<{ reason?: string }> };
}

/**
 * commentThreads.list part=snippet order=relevance maxResults=20
 * textFormat=plainText. 403 commentsDisabled -> { disabled: true }. Other
 * failures -> empty, not disabled. Never logs response bodies.
 */
export async function fetchTopComments(
  videoId: string,
  apiKey: string,
  fetchFn: FetchFn
): Promise<TopCommentsResult> {
  const url =
    `${YT_API_BASE}/commentThreads?part=snippet&order=relevance` +
    `&maxResults=${COMMENT_TOP_N}&textFormat=plainText` +
    `&videoId=${encodeURIComponent(videoId)}&key=${encodeURIComponent(apiKey)}`;
  try {
    const res = await fetchFn(url);
    const body = (await res.json()) as CommentThreadsResponse;
    if (!res.ok) {
      const disabled =
        res.status === HTTP_FORBIDDEN &&
        (body.error?.errors ?? []).some((e) => e.reason === COMMENTS_DISABLED_REASON);
      return { texts: [], disabled };
    }
    const texts = (body.items ?? [])
      .map(
        (i) =>
          i.snippet?.topLevelComment?.snippet?.textOriginal ??
          i.snippet?.topLevelComment?.snippet?.textDisplay ??
          ''
      )
      .filter((t) => t.length > 0);
    return { texts, disabled: false };
  } catch {
    return { texts: [], disabled: false };
  }
}

/** Fetch top comments, count word hits, discard text. Returns counts only. */
export async function commentSignalsForVideo(
  videoId: string,
  apiKey: string,
  fetchFn: FetchFn,
  words: WordLists = DEFAULT_WORD_LISTS
): Promise<CommentSignals> {
  const { texts, disabled } = await fetchTopComments(videoId, apiKey, fetchFn);
  return { ...countCommentSignals(texts, words), disabled };
}
