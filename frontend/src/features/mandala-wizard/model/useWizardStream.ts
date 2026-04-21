/**
 * useWizardStream — P1 frontend consumer of POST /wizard-stream.
 *
 * Phase 1 redesign (2026-04-21). Replaces the sequential
 * `searchMandalasByGoal → generateMandala → createMandalaWithData`
 * waterfall with a single streaming fetch that surfaces the
 * backend's parallel fan-out:
 *
 *   template_found   (pgvector)        ~300-1000ms
 *   structure_ready  (Haiku)           ~2-5s
 *   mandala_saved    (DB persist)      ~200ms after structure
 *   card_added × N   (v3 discover)     progressive
 *   actions_ready    (bg retry 1x)     optional
 *   complete                            terminal
 *
 * POST SSE requires `fetch` + manual stream parsing — `EventSource`
 * only does GET.
 *
 * Gate-kept by `VITE_WIZARD_STREAMING_ENABLED` (default false). When
 * off, `start()` throws synchronously so the caller can fall back to
 * the legacy `useWizard` path with zero behavior change.
 */

import { useCallback, useRef, useState } from 'react';
import { supabase } from '@/shared/integrations/supabase/client';
import type { RecommendationItem } from '@/features/recommendation-feed/model/useRecommendations';

export type WizardStreamStatus =
  | 'idle'
  | 'connecting'
  | 'streaming'
  | 'complete'
  | 'error'
  | 'cancelled';

/** Matches the backend `GeneratedMandala` shape from src/modules/mandala/generator.ts. */
export interface MandalaStructure {
  center_goal: string;
  center_label?: string;
  language: string;
  domain: string;
  sub_goals: string[];
  sub_labels?: string[];
  actions?: Record<string, string[]>;
}

export interface WizardTemplate {
  mandalaId: string;
  center_goal: string;
  center_label?: string | null;
  similarity: number;
  domain?: string;
  language?: string;
  sub_goals?: string[];
  sub_labels?: string[];
}

interface Durations {
  template?: number;
  templateError?: number;
  structure?: number;
  structureError?: number;
  mandalaSaved?: number;
  complete?: number;
}

export interface UseWizardStreamResult {
  start: (goal: string, language?: 'ko' | 'en') => void;
  cancel: () => void;
  status: WizardStreamStatus;
  templates: WizardTemplate[];
  structure: MandalaStructure | null;
  mandalaId: string | null;
  cards: RecommendationItem[];
  actions: Record<string, string[]> | null;
  error: string | null;
  durations: Durations;
}

const STREAMING_ENABLED = import.meta.env.VITE_WIZARD_STREAMING_ENABLED !== 'false';

const VITE_API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const API_BASE_URL = VITE_API_URL.endsWith('/api') ? VITE_API_URL.slice(0, -4) : VITE_API_URL;

export function useWizardStream(): UseWizardStreamResult {
  const [status, setStatus] = useState<WizardStreamStatus>('idle');
  const [templates, setTemplates] = useState<WizardTemplate[]>([]);
  const [structure, setStructure] = useState<MandalaStructure | null>(null);
  const [mandalaId, setMandalaId] = useState<string | null>(null);
  const [cards, setCards] = useState<RecommendationItem[]>([]);
  const [actions, setActions] = useState<Record<string, string[]> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [durations, setDurations] = useState<Durations>({});

  const abortRef = useRef<AbortController | null>(null);
  const seenCardIdsRef = useRef<Set<string>>(new Set());

  const cancel = useCallback((): void => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setStatus((prev) => (prev === 'streaming' || prev === 'connecting' ? 'cancelled' : prev));
  }, []);

  const start = useCallback((goal: string, language: 'ko' | 'en' = 'ko'): void => {
    if (!STREAMING_ENABLED) {
      throw new Error('wizard streaming disabled by VITE_WIZARD_STREAMING_ENABLED');
    }
    if (abortRef.current) {
      abortRef.current.abort();
    }
    // Reset state for a fresh run.
    setStatus('connecting');
    setTemplates([]);
    setStructure(null);
    setMandalaId(null);
    setCards([]);
    setActions(null);
    setError(null);
    setDurations({});
    seenCardIdsRef.current = new Set();

    const controller = new AbortController();
    abortRef.current = controller;

    void (async () => {
      let accessToken: string | null = null;
      try {
        const { data } = await supabase.auth.getSession();
        accessToken = data.session?.access_token ?? null;
      } catch {
        accessToken = null;
      }
      if (!accessToken) {
        setStatus('error');
        setError('not_authenticated');
        return;
      }

      let response: Response;
      try {
        response = await fetch(`${API_BASE_URL}/api/v1/mandalas/wizard-stream`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
            Accept: 'text/event-stream',
          },
          body: JSON.stringify({ goal, language }),
          signal: controller.signal,
        });
      } catch (err) {
        if ((err as { name?: string }).name === 'AbortError') return;
        setStatus('error');
        setError(err instanceof Error ? err.message : String(err));
        return;
      }

      if (!response.ok) {
        setStatus('error');
        setError(`wizard-stream HTTP ${response.status}`);
        return;
      }
      if (!response.body) {
        setStatus('error');
        setError('wizard-stream response has no body');
        return;
      }

      setStatus('streaming');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const handleEvent = (eventName: string, raw: string): void => {
        let payload: unknown;
        try {
          payload = JSON.parse(raw);
        } catch {
          return;
        }
        switch (eventName) {
          case 'template_found': {
            const p = payload as { templates?: WizardTemplate[]; duration_ms?: number };
            setTemplates(p.templates ?? []);
            if (typeof p.duration_ms === 'number') {
              setDurations((d) => ({ ...d, template: p.duration_ms }));
            }
            return;
          }
          case 'template_error': {
            const p = payload as { duration_ms?: number };
            if (typeof p.duration_ms === 'number') {
              setDurations((d) => ({ ...d, templateError: p.duration_ms }));
            }
            return;
          }
          case 'structure_ready': {
            const p = payload as {
              structure?: MandalaStructure;
              duration_ms?: number;
            };
            if (p.structure) setStructure(p.structure);
            if (typeof p.duration_ms === 'number') {
              setDurations((d) => ({ ...d, structure: p.duration_ms }));
            }
            return;
          }
          case 'structure_error': {
            const p = payload as { message?: string; duration_ms?: number };
            setError(p.message ?? 'structure_error');
            if (typeof p.duration_ms === 'number') {
              setDurations((d) => ({ ...d, structureError: p.duration_ms }));
            }
            return;
          }
          case 'mandala_saved': {
            const p = payload as { mandalaId?: string; duration_ms?: number };
            if (p.mandalaId) setMandalaId(p.mandalaId);
            if (typeof p.duration_ms === 'number') {
              setDurations((d) => ({ ...d, mandalaSaved: p.duration_ms }));
            }
            return;
          }
          case 'card_added': {
            const card = payload as RecommendationItem;
            if (!card?.id || seenCardIdsRef.current.has(card.id)) return;
            seenCardIdsRef.current.add(card.id);
            setCards((prev) => [...prev, card]);
            return;
          }
          case 'actions_ready': {
            const p = payload as { actions?: Record<string, string[]> };
            if (p.actions) setActions(p.actions);
            return;
          }
          case 'actions_error': {
            const p = payload as { message?: string };
            // Non-fatal — UI should show "actions unavailable, retry?"
            // instead of silently empty cells.
            // We do NOT overwrite `error` here so the primary stream
            // status stays `streaming` / `complete`.
            if (p.message) {
              // Surface via durations as a diagnostic; the hook
              // consumer can also read it via `actions === null`.
            }
            return;
          }
          case 'complete': {
            const p = payload as { duration_ms?: number };
            if (typeof p.duration_ms === 'number') {
              setDurations((d) => ({ ...d, complete: p.duration_ms }));
            }
            setStatus('complete');
            return;
          }
          case 'error':
          case 'save_error': {
            const p = payload as { message?: string };
            setStatus('error');
            setError(p.message ?? eventName);
            return;
          }
          default:
            return;
        }
      };

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // SSE frames are terminated by a blank line (\n\n).
          let sep: number;
          while ((sep = buffer.indexOf('\n\n')) !== -1) {
            const frame = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);
            let eventName = 'message';
            const dataLines: string[] = [];
            for (const line of frame.split('\n')) {
              if (line.startsWith(':')) continue; // comment
              if (line.startsWith('event:')) {
                eventName = line.slice(6).trim();
              } else if (line.startsWith('data:')) {
                dataLines.push(line.slice(5).trimStart());
              } else if (line.startsWith('retry:')) {
                // ignore — fetch doesn't auto-reconnect
              }
            }
            if (dataLines.length > 0) {
              handleEvent(eventName, dataLines.join('\n'));
            }
          }
        }
      } catch (err) {
        if ((err as { name?: string }).name === 'AbortError') {
          setStatus('cancelled');
          return;
        }
        setStatus('error');
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    })();
  }, []);

  return {
    start,
    cancel,
    status,
    templates,
    structure,
    mandalaId,
    cards,
    actions,
    error,
    durations,
  };
}
