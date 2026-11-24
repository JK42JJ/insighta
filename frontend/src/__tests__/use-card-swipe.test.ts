import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useCardSwipe, SWIPE_DISTANCE_THRESHOLD_PX } from '@/features/morning-cards/use-card-swipe';

const ev = (x: number) => ({ clientX: x }) as unknown as ReactPointerEvent;

function drag(from: number, to: number) {
  const onSwipe = vi.fn();
  const { result } = renderHook(() => useCardSwipe({ onSwipe }));
  act(() => result.current.handlers.onPointerDown(ev(from)));
  act(() => result.current.handlers.onPointerMove(ev(to)));
  act(() => result.current.handlers.onPointerUp(ev(to)));
  return onSwipe;
}

describe('useCardSwipe', () => {
  it('maps right drag to useful and left drag to skip', () => {
    const d = SWIPE_DISTANCE_THRESHOLD_PX + 10;
    const right = drag(100, 100 + d);
    expect(right).toHaveBeenCalledTimes(1);
    expect(right).toHaveBeenCalledWith('useful');
    const left = drag(300, 300 - d);
    expect(left).toHaveBeenCalledTimes(1);
    expect(left).toHaveBeenCalledWith('skip');
  });

  it('ignores a short drag', () => {
    expect(drag(100, 100 + SWIPE_DISTANCE_THRESHOLD_PX - 1)).not.toHaveBeenCalled();
  });
});
