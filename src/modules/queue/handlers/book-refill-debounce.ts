import type PgBoss from 'pg-boss';

/**
 * Debounce for the post-enrich book re-fill. When v2 segments (the book's atom
 * source) are written, the enrich handler enqueues a mandala book re-fill so
 * videos enriched AFTER the book was first built are reflected (fixes the
 * stale-book race that left new mandalas with empty "토픽 0" notes).
 *
 * A mandala with N videos produces N enrichments → without debounce that would
 * be N re-fills (each re-running topic-synthesis Haiku per cell). singletonKey
 * collapses the burst to one queued job per mandala; the 120s delay lets the
 * burst finish first so the single re-fill sees all newly-written v2 atoms.
 *
 * Standalone (type-only import) so it stays free of the config/google-auth
 * module chain — keeps it unit-testable without loading the full handler.
 */
const BOOK_REFILL_DEBOUNCE_SEC = 120;

export function bookRefillEnqueueOptions(mandalaId: string): PgBoss.SendOptions {
  return { singletonKey: `book-fill-${mandalaId}`, startAfter: BOOK_REFILL_DEBOUNCE_SEC };
}

/**
 * PR-T1 — debounce for the card-add-close bulk translation. Multiple closes (or
 * a close fired alongside other events) collapse to ONE queued bulk pass per
 * mandala; the short delay lets the just-added cards' rows settle first.
 */
const TRANSLATE_BULK_DEBOUNCE_SEC = 20;

export function translateBulkEnqueueOptions(mandalaId: string): PgBoss.SendOptions {
  return {
    singletonKey: `translate-bulk-${mandalaId}`,
    startAfter: TRANSLATE_BULK_DEBOUNCE_SEC,
  };
}
