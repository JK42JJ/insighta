// BL-10 (2026-07-03) — the CopilotKit runtime-info probe gates the chat mount
// so the intermittent yoga 400 ("empty payload" race) self-heals instead of
// hanging. These cover the three states: immediate ready, recover-after-retry,
// and exhausted → failed.
import { renderHook, act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useChatRuntimeProbe } from '@/pages/learning/ui/ChatAssistant';

const HEADERS = { Authorization: 'Bearer test-token' };

describe('useChatRuntimeProbe (BL-10 runtime-info retry gate)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test('200 on first probe → ready (no hang, no retry needed)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response);
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useChatRuntimeProbe(HEADERS));
    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/chat/info',
      expect.objectContaining({ method: 'GET' })
    );
  });

  test('400 then 200 → recovers to ready (the intermittent race self-heals)', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false } as Response)
      .mockResolvedValueOnce({ ok: true } as Response);
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useChatRuntimeProbe(HEADERS));
    // let the first (failed) attempt resolve, then advance past the backoff.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(result.current.state).toBe('ready');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('persistent failure → failed after max attempts (manual retry offered)', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue({ ok: false } as Response);
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useChatRuntimeProbe(HEADERS));
    // 5 attempts with 400/800/1600/3200ms backoffs — advance well past total.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(result.current.state).toBe('failed');
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
});
