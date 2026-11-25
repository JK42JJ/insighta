import { act, fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { MOTION, motionStyleVars } from '@/features/morning-feed/motion-tokens';
import { ScreenStack } from '@/features/morning-feed/ScreenStack';
import { usePressFeedback } from '@/features/morning-feed/use-press';
import { appBack, isNativeBack, popIsNative } from '@/features/morning-feed/use-screen-history';

/* Decision 2026-11-14 "앱처럼 반응": the shared press, stack and values. */

function PressHost({ onSoft }: { onSoft?: () => void }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  usePressFeedback(ref);
  return (
    <div ref={ref}>
      <button type="button" data-press="btn" data-testid="b">
        <span data-testid="inner">눌러</span>
      </button>
      <button type="button" data-press="btn" data-testid="off" disabled>
        꺼짐
      </button>
      <button type="button" data-press="soft" data-testid="soft" onClick={onSoft}>
        <span>날짜</span>
      </button>
    </div>
  );
}

describe('pressed look', () => {
  it('appears at pointerdown (on a child too), goes on release and when the finger leaves', () => {
    render(<PressHost />);
    const b = screen.getByTestId('b');
    b.getBoundingClientRect = () => ({ left: 0, right: 100, top: 0, bottom: 40 }) as DOMRect;
    fireEvent.pointerDown(screen.getByTestId('inner'), { pointerId: 1, clientX: 10, clientY: 10 });
    expect(b.hasAttribute('data-pressed')).toBe(true);
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(b.hasAttribute('data-pressed')).toBe(false);

    fireEvent.pointerDown(b, { pointerId: 2, clientX: 10, clientY: 10 });
    expect(b.hasAttribute('data-pressed')).toBe(true);
    fireEvent.pointerMove(window, { pointerId: 2, clientX: 10, clientY: 90 });
    expect(b.hasAttribute('data-pressed')).toBe(false);
  });

  it('a disabled control never looks pressed', () => {
    render(<PressHost />);
    const off = screen.getByTestId('off');
    fireEvent.pointerDown(off, { pointerId: 3 });
    expect(off.hasAttribute('data-pressed')).toBe(false);
  });

  it('soft (head text buttons): shown at the touch; 10 px of movement ends it and its click', () => {
    const onSoft = vi.fn();
    render(<PressHost onSoft={onSoft} />);
    const b = screen.getByTestId('soft');
    b.getBoundingClientRect = () => ({ left: 0, right: 200, top: 0, bottom: 44 }) as DOMRect;
    fireEvent.pointerDown(b, { pointerId: 4, clientX: 20, clientY: 20 });
    expect(b.hasAttribute('data-pressed')).toBe(true);
    // inside the button, but moved
    fireEvent.pointerMove(window, { pointerId: 4, clientX: 29, clientY: 20 });
    expect(b.hasAttribute('data-pressed')).toBe(true);
    fireEvent.pointerMove(window, { pointerId: 4, clientX: 31, clientY: 20 });
    expect(b.hasAttribute('data-pressed')).toBe(false);
    fireEvent.pointerUp(window, { pointerId: 4 });
    fireEvent.click(b, { detail: 1 });
    expect(onSoft).not.toHaveBeenCalled();
    // the next touch is a press again; a keyboard click always is
    fireEvent.pointerDown(b, { pointerId: 5, clientX: 20, clientY: 20 });
    fireEvent.pointerUp(window, { pointerId: 5 });
    expect(b.hasAttribute('data-pressed')).toBe(false);
    fireEvent.click(b, { detail: 1 });
    fireEvent.click(b, { detail: 0 });
    expect(onSoft).toHaveBeenCalledTimes(2);
  });

  it('the values live in one place and reach the CSS as custom properties', () => {
    const v = motionStyleVars() as Record<string, string>;
    expect(v['--mo-press-btn-scale']).toBe('0.97');
    expect(v['--mo-press-icon-scale']).toBe('0.9');
    expect(v['--mo-press-in']).toBe('80ms');
    expect(v['--mo-press-out']).toBe('200ms');
    expect(v['--mo-push-ms']).toBe('350ms');
    expect(v['--mo-push-ease']).toBe('cubic-bezier(0.32, 0.72, 0, 1)');
    expect(MOTION.push.underShift).toBe(0.3);
    expect(MOTION.pop.scale).toBe(1.15);
  });
});

describe('screen stack', () => {
  it('keeps the screens under the top mounted and hidden; a back slides the top out first', async () => {
    const A = { id: 1, node: <div data-testid="a">A</div> };
    const B = { id: 2, node: <div data-testid="b">B</div> };
    const { rerender } = render(
      <ScreenStack layers={[A]} move={{ dir: 'none', native: false, seq: 0 }} />
    );
    rerender(<ScreenStack layers={[A, B]} move={{ dir: 'push', native: false, seq: 1 }} />);
    const layers = screen.getAllByTestId('mf-stack-layer');
    expect(layers).toHaveLength(2);
    await act(async () => {
      await new Promise((r) => setTimeout(r, MOTION.push.ms + 50));
    });
    // A stays mounted under B, hidden (its scroll is kept)
    expect(screen.getByTestId('a')).toBeTruthy();
    expect(screen.getAllByTestId('mf-stack-layer')[0]!.hasAttribute('data-covered')).toBe(true);
    const bNode = screen.getByTestId('b');
    rerender(<ScreenStack layers={[A]} move={{ dir: 'pop', native: false, seq: 2 }} />);
    // the leaving screen is the same element (not mounted again) while it slides out
    expect(screen.getByTestId('b')).toBe(bNode);
    await act(async () => {
      await new Promise((r) => setTimeout(r, MOTION.push.ms + 50));
    });
    expect(screen.queryByTestId('b')).toBeNull();
    expect(screen.getAllByTestId('mf-stack-layer')[0]!.hasAttribute('data-covered')).toBe(false);
  });

  it('a back the browser animates itself changes at once', () => {
    const A = { id: 1, node: <div data-testid="a">A</div> };
    const B = { id: 2, node: <div data-testid="b">B</div> };
    const { rerender } = render(
      <ScreenStack layers={[A, B]} move={{ dir: 'push', native: false, seq: 1 }} />
    );
    rerender(<ScreenStack layers={[A]} move={{ dir: 'pop', native: true, seq: 2 }} />);
    expect(screen.queryByTestId('b')).toBeNull();
  });
});

describe("Safari's own back transition", () => {
  it('is taken from the event, or from an edge touch the browser took just before', () => {
    const ua = new PopStateEvent('popstate');
    Object.defineProperty(ua, 'hasUAVisualTransition', { value: true });
    expect(isNativeBack(ua, 0, 1000)).toBe(true);
    const plain = new PopStateEvent('popstate');
    expect(isNativeBack(plain, 0, 1000)).toBe(false);
    expect(isNativeBack(plain, 900, 1000)).toBe(true);
    expect(isNativeBack(plain, 900, 5000)).toBe(false);
  });
});

describe('whose history move it is (James 2026-11-25)', () => {
  it("the browser's own back never slides; the app's back does, once", () => {
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    expect(popIsNative(new PopStateEvent('popstate'))).toBe(true);
    appBack();
    expect(back).toHaveBeenCalledTimes(1);
    expect(popIsNative(new PopStateEvent('popstate'))).toBe(false);
    // the next one is the browser's again
    expect(popIsNative(new PopStateEvent('popstate'))).toBe(true);
    back.mockRestore();
  });
});
