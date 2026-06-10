/**
 * CP499+ — sentinel observer re-attachment regression (prod 2026-06-10).
 *
 * The old CardList effect attached the IntersectionObserver keyed on
 * [sortedCards.length]; when the sentinel node unmounted and later REMOUNTED
 * on a same-length list, the effect never re-ran → the observer stayed bound
 * to the detached node → infinite scroll dead, tail skeletons forever
 * (25 rendered vs 34 placed). The hook attaches via callback ref so the
 * observation follows the node lifecycle exactly.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSentinelPagination } from '@/widgets/card-list/model/useSentinelPagination';

type IOCallback = (entries: Array<{ isIntersecting: boolean }>) => void;

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];
  observed: Element[] = [];
  disconnected = false;
  constructor(public callback: IOCallback) {
    MockIntersectionObserver.instances.push(this);
  }
  observe(el: Element) {
    this.observed.push(el);
  }
  disconnect() {
    this.disconnected = true;
  }
  unobserve() {}
  takeRecords() {
    return [];
  }
  /** Simulate the sentinel entering the viewport on the LIVE observer. */
  fire(isIntersecting = true) {
    this.callback([{ isIntersecting }]);
  }
}

beforeEach(() => {
  MockIntersectionObserver.instances = [];
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
});

const PAGE_SIZE = 24;
const node = () => document.createElement('div');

describe('useSentinelPagination (CP499+ observer re-attachment)', () => {
  it('grows visibleCount by pageSize, capped at the CURRENT total (no stale clamp)', () => {
    const { result, rerender } = renderHook(
      ({ total }) => useSentinelPagination(total, PAGE_SIZE),
      { initialProps: { total: 34 } }
    );
    expect(result.current.visibleCount).toBe(24);

    const sentinel = node();
    act(() => result.current.sentinelRef(sentinel));
    const obs = MockIntersectionObserver.instances.at(-1)!;
    expect(obs.observed).toContain(sentinel);

    act(() => obs.fire());
    expect(result.current.visibleCount).toBe(34); // min(24+24, 34)

    // Total grows AFTER attachment — the cap must follow the fresh value,
    // not the closure captured at observe-time.
    rerender({ total: 60 });
    act(() => obs.fire());
    expect(result.current.visibleCount).toBe(58); // min(34+24, 60)
  });

  it('REGRESSION: re-attaches to a remounted sentinel on a same-length list', () => {
    const { result } = renderHook(() => useSentinelPagination(34, PAGE_SIZE));

    // Mount → grow to end → sentinel unmounts (hasMore false).
    const first = node();
    act(() => result.current.sentinelRef(first));
    const obs1 = MockIntersectionObserver.instances.at(-1)!;
    act(() => obs1.fire());
    expect(result.current.visibleCount).toBe(34);
    act(() => result.current.sentinelRef(null));
    expect(obs1.disconnected).toBe(true);

    // Window reset (cell/mandala switch, SAME length) → sentinel remounts.
    act(() => result.current.resetVisibleCount());
    expect(result.current.visibleCount).toBe(24);
    const second = node();
    act(() => result.current.sentinelRef(second));

    // The pre-fix code skipped re-attachment here (deps length unchanged) —
    // scroll was dead. The hook must observe the NEW node with a LIVE observer.
    const obs2 = MockIntersectionObserver.instances.at(-1)!;
    expect(obs2).not.toBe(obs1);
    expect(obs2.observed).toContain(second);
    expect(obs2.disconnected).toBe(false);

    act(() => obs2.fire());
    expect(result.current.visibleCount).toBe(34); // scroll alive again
  });

  it('disconnects the live observer when the hook unmounts', () => {
    const { result, unmount } = renderHook(() => useSentinelPagination(34, PAGE_SIZE));
    act(() => result.current.sentinelRef(node()));
    const obs = MockIntersectionObserver.instances.at(-1)!;
    unmount();
    expect(obs.disconnected).toBe(true);
  });
});
