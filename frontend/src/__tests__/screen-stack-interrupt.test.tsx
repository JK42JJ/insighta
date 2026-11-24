import { render } from '@testing-library/react';
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
