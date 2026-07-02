/**
 * HoverFrameThumbnail — hover starts the official-still-frame cycle after a
 * delay; leaving snaps back to the original thumbnail (no iframe, by design).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { HoverFrameThumbnail } from '@/shared/ui/hover-frame-thumbnail';

const THUMB = 'https://i.ytimg.com/vi/abc123/hqdefault.jpg';

const getImg = (container: HTMLElement) => container.querySelector('img') as HTMLImageElement;

afterEach(() => {
  vi.useRealTimers();
});

describe('HoverFrameThumbnail', () => {
  it('shows the original thumbnail when inactive', () => {
    const { container } = render(
      <HoverFrameThumbnail videoId="abc123" thumbnail={THUMB} active={false} />
    );
    expect(getImg(container).src).toBe(THUMB);
  });

  it('starts cycling frames only after the hover delay, then advances', () => {
    vi.useFakeTimers();
    const { container } = render(
      <HoverFrameThumbnail videoId="abc123" thumbnail={THUMB} active={true} />
    );
    // Before the delay: still the original (incidental sweep protection).
    act(() => vi.advanceTimersByTime(200));
    expect(getImg(container).src).toBe(THUMB);
    // After delay: frame 1.
    act(() => vi.advanceTimersByTime(150));
    expect(getImg(container).src).toContain('/vi/abc123/hq1.jpg');
    // After one interval: frame 2.
    act(() => vi.advanceTimersByTime(700));
    expect(getImg(container).src).toContain('/vi/abc123/hq2.jpg');
    // Wraps 3 → 1.
    act(() => vi.advanceTimersByTime(1400));
    expect(getImg(container).src).toContain('/vi/abc123/hq1.jpg');
  });

  it('snaps back to the original thumbnail when deactivated', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(
      <HoverFrameThumbnail videoId="abc123" thumbnail={THUMB} active={true} />
    );
    act(() => vi.advanceTimersByTime(1100)); // 300 delay + 800 → one interval passed = frame 2
    expect(getImg(container).src).toContain('/hq2.jpg');
    rerender(<HoverFrameThumbnail videoId="abc123" thumbnail={THUMB} active={false} />);
    expect(getImg(container).src).toBe(THUMB);
  });

  it('never cycles without a videoId', () => {
    vi.useFakeTimers();
    const { container } = render(
      <HoverFrameThumbnail videoId={null} thumbnail={THUMB} active={true} />
    );
    act(() => vi.advanceTimersByTime(3000));
    expect(getImg(container).src).toBe(THUMB);
  });
});
