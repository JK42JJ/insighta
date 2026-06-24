/**
 * §1④ v2-pending retry cap (PR: book-spinner-retry-cap).
 *
 * A placed card that passed the gate but has no usable v2 segments
 * (quality_flag='low' = all generation attempts failed, INCLUDING transient
 * provider errors — the reason is NOT persisted, so transient vs structural is
 * indistinguishable) is re-enqueued by §1④. Without a cap that re-enqueue is
 * infinite and the "준비 중" spinner (v2_pending > 0) never completes.
 *
 * The cap counter lives in video_rich_summaries.translations._book_v2_retry — a
 * jsonb key the v2 generator + cron NEVER write (verified), so it survives the
 * generator's quality_flag='low' overwrite (sharing the cron's low_retried flag
 * was unsafe: the generator resets it, and §1④'s retry is async so it can't
 * post-mark like the cron's synchronous retry).
 *
 * Standalone (no fill-book import) so it is unit-testable without the queue /
 * google-auth module chain.
 */

/**
 * Re-enqueue a still-segments-less 'low' v2 card at most this many times.
 * 1: the v2 generator already makes MAX_RETRIES+1 = 2 internal attempts (with
 * transient provider_error retried via `continue`) before writing 'low', so by
 * the time §1④ has re-enqueued once (counter=1) the card has had ≥4 attempts and
 * is structural, not transient. Capping at 1 lets the spinner converge in one
 * extra fill without the permanent-loss risk of a blanket 'low' exclude (#968).
 */
export const BOOK_V2_RETRY_CAP = 1;

/** Read the §1④ dedicated retry counter from the translations jsonb. */
export function readBookV2Retry(translations: unknown): number {
  if (!translations || typeof translations !== 'object') return 0;
  const n = (translations as Record<string, unknown>)['_book_v2_retry'];
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}

/** True when the card has been re-enqueued to the cap → treat as terminal. */
export function bookV2RetryCapped(translations: unknown): boolean {
  return readBookV2Retry(translations) >= BOOK_V2_RETRY_CAP;
}
