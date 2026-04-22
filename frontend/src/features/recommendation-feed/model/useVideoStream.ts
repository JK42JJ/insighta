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

  useEffect(() => {
    if (!mandalaId) {
      setCards([]);
      seenRef.current = new Set();
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
      // token via query string. The backend route uses the same
      // `fastify.authenticate` plugin as /recommendations, which
      // reads the token from either header or access_token query
      // param (supabase jwt plugin convention).
      const url = `${API_BASE_URL}/api/v1/mandalas/${mandalaId}/videos/stream?access_token=${encodeURIComponent(accessToken)}`;

      try {
        es = new EventSource(url);
      } catch (err) {
        setStatus('error');
        setError(err instanceof Error ? err.message : String(err));
        return;
      }

      es.addEventListener('open', () => {
        if (cancelled) return;
        setStatus('streaming');
      });

      es.addEventListener('card_added', (ev) => {
        if (cancelled) return;
        try {
          const payload = JSON.parse((ev as MessageEvent).data) as RecommendationItem;
          if (!payload?.id) return;
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

      es.addEventListener('complete', () => {
        if (cancelled) return;
        setStatus('complete');
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
        }
      });
    };

    void connect();

    return () => {
      cancelled = true;
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
