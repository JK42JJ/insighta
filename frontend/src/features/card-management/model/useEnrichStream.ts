/**
 * useEnrichStream — subscribe to the BE Heart-click v2 progress stream.
 *
 * CP462+ Issue #649 Phase 3. Opens an EventSource against
 * `GET /api/v1/cards/:videoId/enrich-stream` and surfaces the 3-phase
 * vocabulary (Fetching / Analyzing / Scored / failed) for the card UI.
 *
 * Auth: same query-param pattern as useVideoStream — Supabase session
 * token is appended as `?access_token=...` because the EventSource API
 * does not allow setting headers. BE auth.ts synthesises an
 * Authorization header from the query param.
 *
 * Lifecycle:
 *   - open()         — call when the user clicks Heart. Opens the stream
 *                      for the supplied videoId, resets `phase` to
 *                      'fetching'.
 *   - close()        — call when the card unmounts or the animation
 *                      completes. Idempotent.
 *   - phase          — most recent phase event from the BE
 *                      ('fetching' | 'analyzing' | 'scored' | 'failed' |
 *                       'timeout' | 'idle').
 *
 * Stream auto-closes when the BE emits a terminal event ('scored' /
 * 'failed' / 'timeout'); call sites usually do not need to invoke
 * close() manually except on unmount.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/shared/integrations/supabase/client';

const VITE_API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const API_BASE_URL = VITE_API_URL.endsWith('/api') ? VITE_API_URL.slice(0, -4) : VITE_API_URL;

export type EnrichPhase = 'idle' | 'fetching' | 'analyzing' | 'scored' | 'failed' | 'timeout';

interface UseEnrichStreamResult {
  phase: EnrichPhase;
  isActive: boolean;
  open: (videoId: string) => Promise<void>;
  close: () => void;
}

export function useEnrichStream(): UseEnrichStreamResult {
  const [phase, setPhase] = useState<EnrichPhase>('idle');
  const [isActive, setIsActive] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  const close = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    setIsActive(false);
  }, []);

  const open = useCallback(async (videoId: string) => {
    // Tear down any previous stream for a different card.
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    setPhase('fetching');
    setIsActive(true);

    let accessToken: string | null = null;
    try {
      const { data } = await supabase.auth.getSession();
      accessToken = data.session?.access_token ?? null;
    } catch {
      accessToken = null;
    }

    if (!accessToken) {
      setPhase('failed');
      setIsActive(false);
      return;
    }

    const params = new URLSearchParams({ access_token: accessToken });
    const url = `${API_BASE_URL}/api/v1/cards/${videoId}/enrich-stream?${params.toString()}`;

    let es: EventSource;
    try {
      es = new EventSource(url);
    } catch {
      setPhase('failed');
      setIsActive(false);
      return;
    }
    esRef.current = es;

    es.addEventListener('phase', (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as { phase: EnrichPhase };
        if (data?.phase) {
          setPhase(data.phase);
          if (data.phase === 'scored' || data.phase === 'failed' || data.phase === 'timeout') {
            es.close();
            esRef.current = null;
            // CP463 — keep chip visible for ~2.5s after the terminal
            // phase so the user sees the completion color before it
            // fades. Setting isActive=false immediately hides the chip
            // and the user just sees the result row pop in with no
            // closure cue.
            setTimeout(() => {
              setIsActive(false);
              setPhase('idle');
            }, 2500);
          }
        }
      } catch {
        // Malformed event — wait for the next one.
      }
    });

    es.addEventListener('error', () => {
      // Browser will auto-reconnect for transient failures; flip to
      // 'failed' only if the connection is truly dead (readyState
      // CLOSED with no further events). The caller can also detect
      // this via `phase === 'failed'`.
      if (es.readyState === EventSource.CLOSED) {
        setPhase('failed');
        setIsActive(false);
      }
    });
  }, []);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      close();
    };
  }, [close]);

  return { phase, isActive, open, close };
}
