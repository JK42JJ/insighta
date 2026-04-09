/**
 * useAutoSave hook tests — debounce timing + status state machine.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAutoSave } from '@/features/side-note-editor/model/useAutoSave';
import { AUTO_SAVE_DEBOUNCE_MS, SAVED_DISPLAY_MS } from '@/features/side-note-editor/config';
import type { TiptapDoc } from '@/features/side-note-editor/lib/note-parser';

const docA: TiptapDoc = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }],
};
const docB: TiptapDoc = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'B' }] }],
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useAutoSave', () => {
  it('debounces trigger and calls save once', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutoSave(save));

    act(() => {
      result.current.trigger(docA);
    });
    expect(save).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS);
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(docA);
  });

  it('resets the debounce on rapid subsequent triggers', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutoSave(save));

    act(() => {
      result.current.trigger(docA);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS - 100);
    });
    act(() => {
      result.current.trigger(docB); // within debounce window → should reset timer
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS - 100);
    });
    // Still inside the reset window → not called yet
    expect(save).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(docB);
  });

  it('transitions status through pending → saving → saved → idle', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutoSave(save));

    act(() => {
      result.current.trigger(docA);
    });
    expect(result.current.status).toBe('pending');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS);
    });
    // After debounce + resolved save, should be in 'saved' state
    expect(result.current.status).toBe('saved');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAVED_DISPLAY_MS);
    });
    expect(result.current.status).toBe('idle');
  });

  it('transitions to error on save rejection', async () => {
    const save = vi.fn().mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useAutoSave(save));

    act(() => {
      result.current.trigger(docA);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS);
    });
    expect(result.current.status).toBe('error');
  });
});
