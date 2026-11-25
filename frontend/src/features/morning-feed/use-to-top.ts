import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

import { prefersReducedMotion } from '@/features/morning-feed/motion-tokens';

/*
 * When the article's "up" button shows (James 2026-11-25): an upward scroll that starts at least
 * 1.5 screens down; gone while scrolling down and near the top, and while it would lie on the
 * reaction area at the article's end.
 */

/** The upward scroll has to start this many screens down. */
export const TO_TOP_SCREENS = 1.5;
/** Nearer to the top than this many screens it is gone. */
export const TO_TOP_NEAR_SCREENS = 0.5;
/** A change of direction counts after this many px (finger jitter). */
export const TO_TOP_TURN_PX = 8;

export interface ToTopState {
  shown: boolean;
  /** Where the current direction started. */
  from: number;
  last: number;
  dir: 'up' | 'down' | null;
  /** The content height at the last event: a change (the note folding) is no scroll. */
  height: number;
}

export const TO_TOP_START: ToTopState = { shown: false, from: 0, last: 0, dir: null, height: 0 };

export function nextToTop(
  s: ToTopState,
  at: { top: number; height: number; screen: number }
): ToTopState {
  // Safari's bounce at either end is not a scroll
  const top = Math.min(Math.max(0, at.top), Math.max(0, at.height - at.screen));
  if (at.height !== s.height) {
    return { ...s, from: top, last: top, dir: null, height: at.height };
  }
  if (top < TO_TOP_NEAR_SCREENS * at.screen) {
    return { shown: false, from: top, last: top, dir: null, height: s.height };
  }
  if (top === s.last) return s;
  const dir = top < s.last ? 'up' : 'down';
  // a turn starts where the scroll was before it
  const from = dir === s.dir ? s.from : s.last;
  let shown = s.shown;
  if (Math.abs(top - from) >= TO_TOP_TURN_PX) {
    if (dir === 'down') shown = false;
    else if (from >= TO_TOP_SCREENS * at.screen) shown = true;
  }
  return { shown, from, last: top, dir, height: s.height };
}

/** Clear space kept between the button and what it must not cover (px). */
const CLEAR_PX = 12;

/**
 * @param avoid finds the area the button must not lie on
 */
export function useToTop(
  scroll: RefObject<HTMLElement>,
  button: RefObject<HTMLElement>,
  avoid: string
): { shown: boolean; over: boolean; go: () => void } {
  const [shown, setShown] = useState(false);
  /** It would lie on what it must not cover: gone at once, without a fade. */
  const [over, setOver] = useState(false);
  const state = useRef<ToTopState>(TO_TOP_START);
  /** On the way up after a press: the scroll itself must not show the button again. */
  const going = useRef(false);

  useEffect(() => {
    const el = scroll.current;
    if (!el) return undefined;
    state.current = {
      ...TO_TOP_START,
      from: el.scrollTop,
      last: el.scrollTop,
      height: el.scrollHeight,
    };
    const covers = (): boolean => {
      const b = button.current?.getBoundingClientRect();
      const a = el.querySelector(avoid)?.getBoundingClientRect();
      return !!a && !!b && b.bottom + CLEAR_PX > a.top && b.top - CLEAR_PX < a.bottom;
    };
    const onScroll = (): void => {
      state.current = nextToTop(state.current, {
        top: el.scrollTop,
        height: el.scrollHeight,
        screen: el.clientHeight,
      });
      if (el.scrollTop <= 0) going.current = false;
      if (going.current) state.current = { ...state.current, shown: false };
      const onIt = state.current.shown && covers();
      setOver(onIt);
      setShown(state.current.shown && !onIt);
    };
    const onTouch = (): void => {
      going.current = false;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    el.addEventListener('pointerdown', onTouch, { passive: true });
    el.addEventListener('wheel', onTouch, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('pointerdown', onTouch);
      el.removeEventListener('wheel', onTouch);
    };
  }, [scroll, button, avoid]);

  const go = useCallback(() => {
    const el = scroll.current;
    if (!el) return;
    going.current = true;
    state.current = { ...state.current, shown: false };
    setShown(false);
    if (prefersReducedMotion() || typeof el.scrollTo !== 'function') el.scrollTop = 0;
    else el.scrollTo({ top: 0, behavior: 'smooth' });
  }, [scroll]);

  return { shown, over, go };
}
