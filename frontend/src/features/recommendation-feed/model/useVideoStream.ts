/**
 * useVideoStream — live card appends via the backend SSE endpoint.
 *
 * Phase 1 slice 4 (post-SGNL-parity audit). Complements
 * `useRecommendations` (polling) by streaming new recommendation
 * rows to the UI as the v3 executor upserts them, instead of
 * waiting for the whole discover pipeline to finish before the
 * next polling interval.
 *
 * Contract:
 *   - On mount, opens an EventSource to
 *     `${API_BASE}/api/v1/mandalas/:id/videos/stream`.
 *   - Authenticates via the same Supabase session token as
 *     apiClient uses (see api-client.ts). The token is injected
 *     as a query param rather than a header because EventSource
 *     does not expose header configuration.
 *   - Appends each `card_added` event payload to the `cards` state,
 *     deduped by `id`.
 *   - Reports `status: 'streaming' | 'complete' | 'error' | 'idle'`
 *     so the caller can gracefully fall back to polling on error.
 *   - Cleans up (closes EventSource) on unmount or mandalaId change.
 *
 * Fallback strategy:
 *   - Any connection error → `status: 'error'`. The caller
 *     (RecommendationFeed) keeps `useRecommendations` polling
 *     active regardless, so a failed stream gracefully degrades to
 *     the pre-slice-2 UX with zero visible regression.
 *   - The `VITE_VIDEO_STREAM_ENABLED` env flag lets ops kill the
 *     feature with a build-time toggle if needed.
 */

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/shared/integrations/supabase/client';
import type { RecommendationItem } from './useRecommendations';

export type StreamStatus = 'idle' | 'connecting' | 'streaming' | 'complete' | 'error';

/** Build-time gate; default true. Set to 'false' to force polling-only mode. */
const STREAM_ENABLED = import.meta.env.VITE_VIDEO_STREAM_ENABLED !== 'false';

/** Mirrors the backend-side VITE_API_URL parsing in shared/lib/api-client.ts. */
const VITE_API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const API_BASE_URL = VITE_API_URL.endsWith('/api') ? VITE_API_URL.slice(0, -4) : VITE_API_URL;

interface UseVideoStreamResult {
  /** Cards received over the SSE stream this session, in arrival order. Deduped by id. */
  cards: RecommendationItem[];
  status: StreamStatus;
  /** Present when status === 'error'. For diagnostics only — callers should fall back. */
  error: string | null;
}

export function useVideoStream(mandalaId: string | null | undefined): UseVideoStreamResult {
  const [cards, setCards] = useState<RecommendationItem[]>([]);
  const [status, setStatus] = useState<StreamStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  // Track the seen-ids set across renders without re-running the
  // effect. Using a ref avoids a state update per card event.
  const seenRef = useRef<Set<string>>(new Set());

  // CP455 SSE PR B — last-seen event id (BE recommendation_cache.id) for
  // reconnect catchup. Survives EventSource auto-reconnect via the
  // Last-Event-ID header set by the browser, AND explicit reconnect via
  // ?lastEventId= query param (heartbeat-watchdog forced reconnect path).
  const lastEventIdRef = useRef<string | null>(null);

  useEffect(() => {
    // mandalaId changed (or first mount) → this is a fresh stream. Drop any
    // cards / seen-ids / lastEventId accumulated for the PREVIOUS mandala.
    // Without this, switching A→B appends B's stream onto A's leftover cards,
    // and useCardOrchestrator.streamMandalaCards force-relabels them with the
    // current mandalaId — so the previous mandala's cards leak into the new
    // one (count inflates until a hard refresh remounts this hook).
    setCards([]);
    seenRef.current = new Set();
    lastEventIdRef.current = null;

    if (!mandalaId) {
      setStatus('idle');
      setError(null);
      return;
    }
    if (!STREAM_ENABLED) {
      setStatus('idle');
      return;
    }

    let cancelled = false;
    let es: EventSource | null = null;
    let watchdog: ReturnType<typeof setTimeout> | null = null;

    // CP455 SSE PR B — heartbeat watchdog. EventSource auto-reconnects on
    // transient errors but if the underlying TCP socket silently dies
    // (proxy/CDN idle close, mid-stream timeout) the browser may not
    // detect it for tens of seconds. BE emits `heartbeat` every 20s — we
    // expect any event (heartbeat / card_added / backlog_done) within
    // 35s. After 35s of silence, force-close + reopen with lastEventId.
    const WATCHDOG_MS = 35_000;
    const armWatchdog = (): void => {
      if (watchdog) clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        if (cancelled) return;
        // Force reconnect — passes lastEventIdRef.current via query param
        // so BE skips rows already seen. Browser-native Last-Event-ID
        // header path also works for transient auto-reconnects, but
        // forcing close+reopen is more reliable for stuck-socket case.
        es?.close();
        void connect();
      }, WATCHDOG_MS);
    };

    const connect = async (): Promise<void> => {
      setStatus('connecting');
      setError(null);

      // Supabase session token. Without it the SSE endpoint will
      // 401 and the connection will error immediately.
      let accessToken: string | null = null;
      try {
        const { data } = await supabase.auth.getSession();
        accessToken = data.session?.access_token ?? null;
      } catch {
        // Treat as not signed in.
        accessToken = null;
      }

      if (cancelled) return;
      if (!accessToken) {
        setStatus('error');
        setError('not_authenticated');
        return;
      }

      // EventSource can't set Authorization headers — pass the
      // token via query string. BE auth.ts (PR #620) synthesizes
      // Authorization header from `?access_token=` query param so
      // the existing jwtVerify path runs unchanged. CP455 PR B
      // also passes `?lastEventId=` for explicit reconnect catchup
      // (browser-native Last-Event-ID header path also works on
      // automatic EventSource reconnect — we set both).
      const params = new URLSearchParams({ access_token: accessToken });
      if (lastEventIdRef.current) {
        params.set('lastEventId', lastEventIdRef.current);
      }
      const url = `${API_BASE_URL}/api/v1/mandalas/${mandalaId}/videos/stream?${params.toString()}`;

      try {
        es = new EventSource(url);
      } catch (err) {
        setStatus('error');
        setError(err instanceof Error ? err.message : String(err));
        return;
      }

      armWatchdog();

      es.addEventListener('open', () => {
        if (cancelled) return;
        setStatus('streaming');
        armWatchdog();
      });

      es.addEventListener('card_added', (ev) => {
        if (cancelled) return;
        armWatchdog();
        try {
          const payload = JSON.parse((ev as MessageEvent).data) as RecommendationItem;
          if (!payload?.id) return;
          // Track last event id across reconnects (use MessageEvent.lastEventId
          // when present — BE sets `id:` per CP455 PR A — fall back to payload.id).
          const eventId = (ev as MessageEvent).lastEventId || payload.id;
          lastEventIdRef.current = eventId;
          if (seenRef.current.has(payload.id)) return;
          seenRef.current.add(payload.id);
          // CP416 Phase A (2026-04-22): sort by relevance (recScore desc)
          // on arrival, not append order. User directive requires the
          // most-relevant cards to float to the top as they arrive.
          // Higher-score cards arriving later bubble up; lower-score
          // arrivals slot underneath. Binary insert — O(log n) search,
          // O(n) array splice; negligible at dashboard scale (<= 24-96
          // cards per mandala).
          setCards((prev) => insertByScoreDesc(prev, payload));
        } catch {
          // Ignore malformed event — the next event will come
          // through cleanly. Don't flip to error state for a
          // single parse failure.
        }
      });

      es.addEventListener('heartbeat', () => {
        if (cancelled) return;
        armWatchdog();
      });

      es.addEventListener('backlog_done', () => {
        if (cancelled) return;
        armWatchdog();
      });

      es.addEventListener('complete', () => {
        if (cancelled) return;
        setStatus('complete');
        if (watchdog) clearTimeout(watchdog);
        es?.close();
      });

      es.addEventListener('error', () => {
        if (cancelled) return;
        // EventSource fires a generic 'error' both on transient
        // network blips (which it auto-reconnects from) and on
        // permanent failures. Check readyState to distinguish:
        //   CONNECTING (0) → reconnecting; keep status=streaming
        //   CLOSED (2)     → permanent failure
        if (es?.readyState === EventSource.CLOSED) {
          setStatus('error');
          setError('connection_closed');
          if (watchdog) clearTimeout(watchdog);
        }
      });
    };

    void connect();

    return () => {
      cancelled = true;
      if (watchdog) clearTimeout(watchdog);
      es?.close();
      es = null;
    };
  }, [mandalaId]);

  return { cards, status, error };
}

/**
 * Insert `item` into the sorted `list` so the result stays ordered by
 * `recScore` DESC. Ties: earlier-arriving item stays first (stable).
 * Exported for testing.
 */
export function insertByScoreDesc(
  list: RecommendationItem[],
  item: RecommendationItem
): RecommendationItem[] {
  const s = item.recScore;
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    // First index where the existing card's score < s (we want to
    // slot before it). Tie-break: keep existing above the incoming
    // (stable arrival-time for equal scores).
    const existing = list[mid];
    if (existing !== undefined && existing.recScore < s) {
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }
  return [...list.slice(0, lo), item, ...list.slice(lo)];
}
