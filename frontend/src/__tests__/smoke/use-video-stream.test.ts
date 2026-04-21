/**
 * useVideoStream — smoke test (Phase 1 slice 4).
 *
 * Covers:
 *   - status transitions (idle → connecting → streaming → complete)
 *   - card_added event appends card to state
 *   - dedupe by id
 *   - readyState=CLOSED error transitions status to 'error'
 *   - cleanup closes EventSource on unmount
 *
 * Mocks:
 *   - EventSource (jsdom lacks native implementation)
 *   - Supabase session (getSession returns a fake access_token)
 *   - import.meta.env (VITE_API_URL + VITE_VIDEO_STREAM_ENABLED)
 *
 * Does NOT cover:
 *   - Real network behaviour / backend integration. That's covered
 *     by the manual prod smoke in PR #430 and the existing
 *     publisher unit test.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// ---- Mock supabase session ------------------------------------------------
// vi.hoisted is required: vi.mock is hoisted to the top of the file so a
// non-hoisted local would be in TDZ when the factory runs. (Mirrors the
// jest.mock lesson captured in memory from CP406.)
const { mockGetSession } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
}));

vi.mock('@/shared/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: mockGetSession,
    },
  },
}));

// ---- Mock EventSource -----------------------------------------------------
// Capture the most recently-constructed instance so tests can drive it.
class FakeEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;

  static instances: FakeEventSource[] = [];

  readyState = FakeEventSource.CONNECTING;
  url: string;
  private listeners: Record<string, ((ev: MessageEvent | Event) => void)[]> = {};
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(event: string, handler: (ev: MessageEvent | Event) => void): void {
    (this.listeners[event] ??= []).push(handler);
  }

  dispatch(event: string, data?: string): void {
    const handlers = this.listeners[event] ?? [];
    const ev = data !== undefined ? new MessageEvent(event, { data }) : new Event(event);
    handlers.forEach((h) => h(ev));
  }

  /** Simulate server sending `event: card_added`. */
  emitCard(payload: Record<string, unknown>): void {
    this.dispatch('card_added', JSON.stringify(payload));
  }

  /** Simulate server-sent `event: complete`. */
  emitComplete(): void {
    this.dispatch('complete');
  }

  /** Simulate permanent connection failure. */
  emitPermanentError(): void {
    this.readyState = FakeEventSource.CLOSED;
    this.dispatch('error');
  }

  /** Simulate `open` (transition from CONNECTING → OPEN). */
  emitOpen(): void {
    this.readyState = FakeEventSource.OPEN;
    this.dispatch('open');
  }

  close(): void {
    this.readyState = FakeEventSource.CLOSED;
    this.closed = true;
  }
}

(globalThis as unknown as { EventSource: typeof FakeEventSource }).EventSource = FakeEventSource;

// ---- Import under test (must come after env + mocks) ---------------------
import { useVideoStream } from '@/features/recommendation-feed/model/useVideoStream';

function sampleCard(overrides: Record<string, unknown> = {}) {
  return {
    id: 'row-1',
    videoId: 'vid-xyz',
    title: 'Daily routine',
    channel: 'Ch',
    thumbnail: null,
    durationSec: 600,
    recScore: 0.8,
    cellIndex: 0,
    cellLabel: null,
    keyword: 'routine',
    source: 'auto_recommend',
    recReason: null,
    ...overrides,
  };
}

beforeEach(() => {
  FakeEventSource.instances = [];
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: 'TOKEN_ABC' } },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useVideoStream', () => {
  it('null mandalaId → status=idle, no EventSource constructed', () => {
    const { result } = renderHook(() => useVideoStream(null));
    expect(result.current.status).toBe('idle');
    expect(result.current.cards).toEqual([]);
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it('mandalaId provided → connects and transitions to streaming on open', async () => {
    const { result } = renderHook(() => useVideoStream('m1'));

    // Effect runs async (supabase.auth.getSession is async).
    await waitFor(() => {
      expect(FakeEventSource.instances).toHaveLength(1);
    });
    expect(FakeEventSource.instances[0]?.url).toContain('/api/v1/mandalas/m1/videos/stream');
    expect(FakeEventSource.instances[0]?.url).toContain('access_token=TOKEN_ABC');

    // Dispatch open event → status=streaming.
    act(() => {
      FakeEventSource.instances[0]?.emitOpen();
    });
    await waitFor(() => {
      expect(result.current.status).toBe('streaming');
    });
  });

  it('card_added events append to cards state', async () => {
    const { result } = renderHook(() => useVideoStream('m1'));
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const es = FakeEventSource.instances[0]!;
    act(() => es.emitOpen());

    act(() => es.emitCard(sampleCard({ id: 'r1', videoId: 'v1' })));
    act(() => es.emitCard(sampleCard({ id: 'r2', videoId: 'v2' })));

    await waitFor(() => expect(result.current.cards).toHaveLength(2));
    expect(result.current.cards[0]?.id).toBe('r1');
    expect(result.current.cards[1]?.id).toBe('r2');
  });

  it('dedupes cards by id (duplicate event ignored)', async () => {
    const { result } = renderHook(() => useVideoStream('m1'));
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const es = FakeEventSource.instances[0]!;
    act(() => es.emitOpen());

    act(() => es.emitCard(sampleCard({ id: 'r1' })));
    act(() => es.emitCard(sampleCard({ id: 'r1', videoId: 'different' })));
    act(() => es.emitCard(sampleCard({ id: 'r2' })));

    await waitFor(() => expect(result.current.cards).toHaveLength(2));
    expect(result.current.cards.map((c) => c.id)).toEqual(['r1', 'r2']);
  });

  it('complete event closes EventSource and sets status=complete', async () => {
    const { result } = renderHook(() => useVideoStream('m1'));
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const es = FakeEventSource.instances[0]!;
    act(() => es.emitOpen());
    act(() => es.emitComplete());

    await waitFor(() => expect(result.current.status).toBe('complete'));
    expect(es.closed).toBe(true);
  });

  it('permanent connection error → status=error', async () => {
    const { result } = renderHook(() => useVideoStream('m1'));
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const es = FakeEventSource.instances[0]!;
    act(() => es.emitOpen());
    act(() => es.emitPermanentError());

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBe('connection_closed');
  });

  it('unmount closes EventSource', async () => {
    const { unmount } = renderHook(() => useVideoStream('m1'));
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const es = FakeEventSource.instances[0]!;
    unmount();
    expect(es.closed).toBe(true);
  });

  it('missing session access_token → status=error immediately (no EventSource opened)', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    const { result } = renderHook(() => useVideoStream('m1'));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBe('not_authenticated');
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it('malformed card_added data → does not throw, next valid event still appends', async () => {
    const { result } = renderHook(() => useVideoStream('m1'));
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const es = FakeEventSource.instances[0]!;
    act(() => es.emitOpen());

    // Dispatch malformed data directly.
    act(() => es.dispatch('card_added', '{ not json'));
    act(() => es.emitCard(sampleCard({ id: 'after-bad' })));

    await waitFor(() => expect(result.current.cards).toHaveLength(1));
    expect(result.current.cards[0]?.id).toBe('after-bad');
  });
});
