import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useScreenHistory } from '@/features/morning-feed/use-screen-history';

type S = { kind: string; n?: number };
const same = (a: S, b: S): boolean => a.kind === b.kind && a.kind === 'watch';

describe('screens in the browser history (scenario test 2026-11-14, S8)', () => {
  it('a new screen pushes an entry and the browser back returns to the previous screen', () => {
    const { result } = renderHook(() => useScreenHistory<S>(() => ({ kind: 'home' }), same));
    const len0 = window.history.length;
    act(() => result.current[1]({ kind: 'page' }));
    expect(window.history.length).toBe(len0 + 1);
    act(() => result.current[1]({ kind: 'past' }));
    expect(result.current[0].kind).toBe('past');
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate', { state: { mfScreen: 1 } }));
    });
    expect(result.current[0].kind).toBe('page');
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate', { state: { mfScreen: 0 } }));
    });
    expect(result.current[0].kind).toBe('home');
  });

  it('an update of the same screen or a redirect replaces the entry', () => {
    const { result } = renderHook(() => useScreenHistory<S>(() => ({ kind: 'home' }), same));
    act(() => result.current[1]({ kind: 'watch', n: 0 }));
    const len = window.history.length;
    act(() => result.current[1]({ kind: 'watch', n: 5 }));
    act(() => result.current[1]({ kind: 'home' }, { replace: true }));
    expect(window.history.length).toBe(len);
    expect(result.current[0].kind).toBe('home');
  });

  it('an entry pushed by someone else on top (the page video layer) does not change the screen', () => {
    const { result } = renderHook(() => useScreenHistory<S>(() => ({ kind: 'home' }), same));
    act(() => result.current[1]({ kind: 'page' }));
    const page = result.current[0];
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate', { state: { mfScreen: 1 } }));
    });
    expect(result.current[0]).toBe(page);
  });
});
