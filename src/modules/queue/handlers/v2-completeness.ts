/**
 * What state a video's v2 summary is in — one answer, read by everyone.
 *
 * There were two answers before, and they disagreed. The book asked "does this
 * row have time segments I can build sections from"; the enrich handler asked
 * "is this row template v2, transcript-grounded and relevance-scored". A row
 * that is all of the latter and none of the former — `quality_flag='pass'` with
 * `segments` null — was unusable to the book and complete to enrich. The book
 * asked for it to be regenerated; enrich returned a cache hit; the card sat in
 * the "generating" count for as long as anyone left the tab open. Ten of them
 * on one mandala when this was measured.
 *
 * The second disagreement was narrower and the same shape. The book split
 * cards by `quality_flag === 'low'`, and the vocabulary in this codebase has
 * six values — pass, pending, low, enrichment_low, failed, skipped. The five
 * that are not `'low'` all fell through to "generating", including a card with
 * no row at all, which can never leave that bucket: the retry counter that
 * would retire it is an UPDATE on the row that does not exist.
 *
 * So the states are named here and the callers read them. A seventh flag added
 * later has to be classified in this file, where the compiler asks for it,
 * rather than silently joining whichever bucket the `else` leads to.
 */

import { bookV2RetryCapped } from '@/modules/mandala-book/book-v2-retry';

/** The quality_flag vocabulary, as written across the codebase. */
export type V2QualityFlag = 'pass' | 'pending' | 'low' | 'enrichment_low' | 'failed' | 'skipped';

export interface V2CompletenessRow {
  template_version?: string | null;
  transcript_used?: boolean | null;
  mandala_relevance_pct?: number | null;
  quality_flag?: string | null;
  /** Null means the generator produced no time segments — nothing to build from. */
  segments?: unknown;
  /** Carries the `_book_v2_retry` counter. */
  translations?: unknown;
}

export type V2State =
  /** Has everything a book section needs. */
  | 'usable'
  /** Genuinely being made for the first time. The only state a spinner counts. */
  | 'generating'
  /** Failed, with attempts left. Retried in the background, silently. */
  | 'retryable'
  /** Will not become usable. Stop asking, stop counting it. */
  | 'terminal';

/**
 * Classify one row.
 *
 * `row` is null when the video has no `video_rich_summaries` row at all.
 * `hasPendingAttempt` says whether something is currently working on it — a
 * live enrich job, or an enqueue this fill just made. Without it a rowless
 * video is indistinguishable from one nobody ever tried, and the two need
 * opposite answers: the first is generating, the second is terminal, and
 * treating the second as the first is what made the spinner immortal.
 */
export function v2State(
  row: V2CompletenessRow | null | undefined,
  hasPendingAttempt = false
): V2State {
  if (!row) return hasPendingAttempt ? 'generating' : 'terminal';

  const flag = row.quality_flag as V2QualityFlag | null | undefined;
  if (flag === 'skipped') return 'terminal';

  // Segments are the thing a book section is built from. A row without them
  // cannot become one, whatever else it says about itself.
  const hasSegments = row.segments != null;

  if (flag === 'pass') {
    if (hasSegments) return 'usable';
    // Passed generation and produced nothing to build from. Re-running it is
    // what the old code did, and it returned a cache hit every time, because
    // the completeness check did not look at segments. It does now, so this
    // row is reported for what it is rather than queued forever.
    return 'terminal';
  }

  if (flag === 'low' || flag === 'enrichment_low' || flag === 'failed') {
    return bookV2RetryCapped(row.translations) ? 'terminal' : 'retryable';
  }

  // 'pending', or a flag this file has not been taught yet. Both mean the row
  // exists but is not finished; whether to keep waiting depends on whether the
  // counter says we have already waited enough.
  if (bookV2RetryCapped(row.translations)) return 'terminal';
  return hasPendingAttempt || flag === 'pending' ? 'generating' : 'retryable';
}

/**
 * The enrich handler's skip gate: is there already a summary worth keeping.
 *
 * Defined on `v2State` so the two callers cannot drift apart again. The extra
 * `template_version` / `transcript_used` / `mandala_relevance_pct` conditions
 * stay — a row can carry segments and still be a v1 row, or one generated
 * without a transcript, and neither should suppress a real generation.
 */
export function isCompleteV2(row: V2CompletenessRow | null | undefined): boolean {
  return (
    !!row &&
    row.template_version === 'v2' &&
    row.transcript_used === true &&
    row.mandala_relevance_pct != null &&
    v2State(row) === 'usable'
  );
}
