/**
 * useWizardStream — smoke tests (P1 frontend consumer).
 *
 * Mocks fetch + ReadableStream to drive SSE frames into the hook
 * and asserts state transitions end-to-end.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const { mockGetSession } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
}));

vi.mock('@/shared/integrations/supabase/client', () => ({
  supabase: { auth: { getSession: mockGetSession } },
}));

/**
 * Build a mock Response whose body emits the given SSE frames. Each
 * entry is a string (one full SSE frame, already double-newline
 * terminated).
 */
function responseWithFrames(frames: string[]): Response {
  const encoder = new TextEncoder();
  let i = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= frames.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(frames[i]!));
      i++;
    },
  });
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

import { useWizardStream } from '@/features/mandala-wizard/model/useWizardStream';

beforeEach(() => {
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ data: { session: { access_token: 'TOKEN' } } });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useWizardStream — parses SSE frames into state', () => {
  it('starts idle', () => {
    const { result } = renderHook(() => useWizardStream());
    expect(result.current.status).toBe('idle');
    expect(result.current.templates).toEqual([]);
    expect(result.current.structure).toBeNull();
    expect(result.current.cards).toEqual([]);
  });

  it('transitions idle → connecting → streaming → complete + fills state', async () => {
    const fetchMock = vi.fn(async () =>
      responseWithFrames([
        'event: template_found\ndata: {"templates":[{"mandalaId":"t1","center_goal":"g","similarity":0.9}],"duration_ms":450}\n\n',
        'event: structure_ready\ndata: {"structure":{"center_goal":"goal","language":"ko","domain":"general","sub_goals":["a","b","c","d","e","f","g","h"]},"duration_ms":3200}\n\n',
        'event: mandala_saved\ndata: {"mandalaId":"mid-123","duration_ms":120}\n\n',
        'event: card_added\ndata: {"id":"r1","videoId":"v1","title":"t","channel":null,"thumbnail":null,"durationSec":null,"recScore":0.5,"cellIndex":0,"cellLabel":null,"keyword":"","source":"auto_recommend","recReason":null}\n\n',
        'event: card_added\ndata: {"id":"r2","videoId":"v2","title":"t2","channel":null,"thumbnail":null,"durationSec":null,"recScore":0.5,"cellIndex":1,"cellLabel":null,"keyword":"","source":"auto_recommend","recReason":null}\n\n',
        'event: complete\ndata: {"duration_ms":11000,"mandalaId":"mid-123"}\n\n',
      ])
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useWizardStream());
    act(() => {
      result.current.start('goal', 'ko');
    });

    await waitFor(() => expect(result.current.status).toBe('complete'));
    expect(result.current.templates).toHaveLength(1);
    expect(result.current.templates[0]?.mandalaId).toBe('t1');
    expect(result.current.structure?.sub_goals).toHaveLength(8);
    expect(result.current.mandalaId).toBe('mid-123');
    expect(result.current.cards).toHaveLength(2);
    expect(result.current.durations).toMatchObject({
      template: 450,
      structure: 3200,
      mandalaSaved: 120,
      complete: 11000,
    });
  });

  it('dedupes card_added by id', async () => {
    const fetchMock = vi.fn(async () =>
      responseWithFrames([
        'event: card_added\ndata: {"id":"dup","videoId":"v","title":"t","channel":null,"thumbnail":null,"durationSec":null,"recScore":0.5,"cellIndex":0,"cellLabel":null,"keyword":"","source":"auto_recommend","recReason":null}\n\n',
        'event: card_added\ndata: {"id":"dup","videoId":"v","title":"t-again","channel":null,"thumbnail":null,"durationSec":null,"recScore":0.5,"cellIndex":0,"cellLabel":null,"keyword":"","source":"auto_recommend","recReason":null}\n\n',
        'event: complete\ndata: {}\n\n',
      ])
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useWizardStream());
    act(() => result.current.start('g'));
    await waitFor(() => expect(result.current.status).toBe('complete'));
    expect(result.current.cards).toHaveLength(1);
  });

  it('missing session → status=error without fetch called', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useWizardStream());
    act(() => result.current.start('g'));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBe('not_authenticated');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('non-200 response → status=error', async () => {
    const fetchMock = vi.fn(async () => new Response('nope', { status: 500 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useWizardStream());
    act(() => result.current.start('g'));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toMatch(/500/);
  });

  it('cancel() aborts the in-flight request', async () => {
    let abortReason: unknown = null;
    const fetchMock = vi.fn(async (_url: string, init: RequestInit = {}) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init.signal as AbortSignal | undefined;
        if (signal) {
          signal.addEventListener(
            'abort',
            () => {
              abortReason = (signal as AbortSignal).reason;
              const err = new Error('aborted');
              (err as Error & { name: string }).name = 'AbortError';
              reject(err);
            },
            { once: true }
          );
        }
      });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useWizardStream());
    act(() => result.current.start('g'));
    await waitFor(() => expect(result.current.status).toBe('connecting'));
    act(() => result.current.cancel());
    await waitFor(() => expect(result.current.status).toBe('cancelled'));
    // We don't assert the exact abort reason — WebKit/Node differ.
    void abortReason;
  });

  it('error event sets status=error with message', async () => {
    const fetchMock = vi.fn(async () =>
      responseWithFrames(['event: error\ndata: {"message":"orchestrator failed"}\n\n'])
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useWizardStream());
    act(() => result.current.start('g'));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBe('orchestrator failed');
  });
});
