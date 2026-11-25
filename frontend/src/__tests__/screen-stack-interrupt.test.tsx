import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ScreenStack } from '@/features/morning-feed/ScreenStack';
import type { ScreenMove } from '@/features/morning-feed/use-screen-history';

/*
 * Regression (James 2026-11-24, iPhone): a Safari edge back during the push slide left the home
 * screen 30 % left and dimmed for good. The slides use fill 'both'; an interrupted one that is
 * finished instead of cancelled keeps its end pose on the page.
 */
interface FakeAnim {
  finished: Promise<void>;
  cancel: ReturnType<typeof vi.fn>;
  finish: ReturnType<typeof vi.fn>;
}
const made: FakeAnim[] = [];

function installAnimate(): void {
  Object.defineProperty(HTMLElement.prototype, 'animate', {
    configurable: true,
    value: () => {
      const a: FakeAnim = {
        finished: new Promise<void>(() => undefined),
        cancel: vi.fn(),
        finish: vi.fn(),
      };
      made.push(a);
      return a;
    },
  });
}

const layer = (id: number) => ({ id, node: <div>screen {id}</div> });
const move = (dir: ScreenMove['dir'], seq: number, native = false): ScreenMove => ({
  dir,
  native,
  seq,
});

afterEach(() => {
  made.length = 0;
  delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
});

describe('ScreenStack: an interrupted slide leaves nothing behind', () => {
  it('a native (edge-swipe) back in the middle of a push cancels the running slide, never finishes it', () => {
    installAnimate();
    const { rerender } = render(<ScreenStack layers={[layer(1)]} move={move('none', 0)} />);
    rerender(<ScreenStack layers={[layer(1), layer(2)]} move={move('push', 1)} />);
    const running = made.slice();
    expect(running.length).toBeGreaterThan(0); // the push slide started and has not ended
    rerender(<ScreenStack layers={[layer(1)]} move={move('pop', 2, true)} />);
    for (const a of running) {
      expect(a.finish).not.toHaveBeenCalled();
      expect(a.cancel).toHaveBeenCalled();
    }
  });
});

/*
 * Regression (James 2026-11-25): at the end of a back slide the animations were removed before the
 * leaving screen was taken away, so it lost its end pose and covered the home for one frame.
 */
describe('ScreenStack: the end of a back slide', () => {
  it('takes the leaving screen away before its animation is removed', async () => {
    let finish: () => void = () => undefined;
    const done = new Promise<void>((r) => {
      finish = r;
    });
    const leavingAtCancel: boolean[] = [];
    Object.defineProperty(HTMLElement.prototype, 'animate', {
      configurable: true,
      value: () => ({
        finished: done,
        cancel: () => leavingAtCancel.push(screen.queryByText('screen 2') !== null),
      }),
    });
    const { rerender } = render(
      <ScreenStack layers={[layer(1), layer(2)]} move={move('none', 0)} />
    );
    rerender(<ScreenStack layers={[layer(1)]} move={move('pop', 1)} />);
    expect(screen.queryByText('screen 2')).not.toBeNull();
    await act(async () => {
      finish();
      await done;
    });
    expect(screen.queryByText('screen 2')).toBeNull();
    expect(leavingAtCancel.length).toBeGreaterThan(0);
    expect(leavingAtCancel.every((there) => !there)).toBe(true);
  });
});
