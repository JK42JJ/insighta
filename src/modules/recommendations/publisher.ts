/**
 * recommendations/publisher — in-process card event bus.
 *
 * Phase 1 slice 2 (SSE streaming): v3 executor calls `notifyCardAdded`
 * right after each `recommendation_cache.upsert`, and the
 * `/api/v1/mandalas/:id/videos/stream` SSE handler subscribes to the
 * same channel. The SSE handler forwards each event as
 * `event: card_added` to the browser's EventSource, giving the user
 * first-card visibility in ~1-2s instead of waiting for the whole
 * discover pipeline to complete.
 *
 * This is an **in-process** implementation, intentionally.
 * v3/executor.ts runs inside the same Node process as the HTTP
 * server (registered via `registerPlugin` in `skills/index.ts`), so
 * a Node `EventEmitter` is the fastest and simplest transport. A
 * PostgreSQL `LISTEN/NOTIFY` variant was considered and rejected:
 * identical user-visible behavior, but would add a dedicated
 * direct-URL connection per subscriber (Supabase free-tier cap 60)
 * and an extra ms of round-trip on every card.
 *
 * The `CardPublisher` interface keeps the seam open for a future
 * `PgCardPublisher` / `RedisCardPublisher` swap when Insighta moves
 * to multi-instance deploy. Replacing the single `cardPublisher`
 * export with a different implementation is the only change needed.
 */

import { EventEmitter } from 'events';

/**
 * Payload shape for a single recommendation_cache row delivered
 * over SSE. Fields mirror the existing GET /:id/recommendations
 * response so the frontend can render both sources through the same
 * component tree.
 */
export interface CardPayload {
  id: string;
  videoId: string;
  title: string;
  channel: string | null;
  thumbnail: string | null;
  durationSec: number | null;
  recScore: number;
  cellIndex: number;
  cellLabel: string | null;
  keyword: string;
  source: 'auto_recommend' | 'manual';
  recReason: string | null;
}

/** Unsubscribe callback returned by `subscribe`. Idempotent. */
export type CardUnsubscribe = () => void;

export interface CardPublisher {
  /**
   * Publish a single card event for the given mandala. Non-blocking.
   * Listeners for the mandala's channel receive the payload
   * synchronously on the same tick.
   */
  notify(mandalaId: string, payload: CardPayload): void;

  /**
   * Subscribe to card events for a single mandala. Returns an
   * `unsubscribe` function — callers MUST invoke it on cleanup
   * (SSE disconnect, timeout, etc.) or memory + max-listeners
   * warnings accumulate.
   */
  subscribe(mandalaId: string, listener: (payload: CardPayload) => void): CardUnsubscribe;
}

/**
 * In-process `EventEmitter`-backed publisher. Per-mandala channel
 * keys keep unrelated listeners isolated so a card for mandala A
 * does not touch a listener for mandala B.
 */
export class MemoryCardPublisher implements CardPublisher {
  /**
   * Cap is a safety net. Under normal load we expect ~1 listener
   * per active mandala SSE session; a user with 5 tabs + a
   * stream-per-tab is 5. `Infinity` would hide a leak, `10` (Node
   * default) would warn in normal use, so 100 is the middle ground.
   */
  private static readonly MAX_LISTENERS = 100;

  private readonly emitter: EventEmitter;

  constructor() {
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(MemoryCardPublisher.MAX_LISTENERS);
  }

  notify(mandalaId: string, payload: CardPayload): void {
    this.emitter.emit(channelFor(mandalaId), payload);
  }

  subscribe(mandalaId: string, listener: (payload: CardPayload) => void): CardUnsubscribe {
    const channel = channelFor(mandalaId);
    this.emitter.on(channel, listener);
    let off = false;
    return () => {
      if (off) return;
      off = true;
      this.emitter.off(channel, listener);
    };
  }
}

/** Channel key used by both notify and subscribe. Exported for tests. */
export function channelFor(mandalaId: string): string {
  return `rec_cache:${mandalaId}`;
}

/**
 * Process-global publisher instance. v3 executor imports this and
 * calls `notify`; the SSE route imports the same instance and
 * subscribes. Any future swap (Pg/Redis) replaces this single
 * export.
 */
export const cardPublisher: CardPublisher = new MemoryCardPublisher();

/**
 * Convenience wrapper that v3 executor calls. Keeps the call site
 * free of `cardPublisher` imports and makes the intent readable.
 */
export function notifyCardAdded(mandalaId: string, payload: CardPayload): void {
  cardPublisher.notify(mandalaId, payload);
}
