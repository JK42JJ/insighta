import { useEffect, useState } from 'react';

/*
 * A phone held sideways (decision 2026-11-14): the watch screen then shows only the player,
 * as large as the screen allows, and moving between videos waits until the phone is upright.
 * iPhone Safari can neither lock the orientation nor put an element in fullscreen, so the page
 * rotates and only its layout can change. Desktop windows are landscape too: the touch pointer
 * and the short height keep them out.
 */
/** A short screen held sideways. */
export const SIDEWAYS_QUERY = '(orientation: landscape) and (max-height: 540px)';
/** A touch screen as the main pointer. */
export const COARSE_QUERY = '(pointer: coarse)';

/**
 * A touch device: the coarse pointer, or touch points (scenario test 2026-11-14: some browsers
 * report the coarse pointer only after the first touch; a phone has touch points from the start).
 */
function isTouchDevice(): boolean {
  return (
    !!window.matchMedia?.(COARSE_QUERY).matches ||
    (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0)
  );
}

function sidewaysNow(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!window.matchMedia?.(SIDEWAYS_QUERY).matches &&
    isTouchDevice()
  );
}

export function usePhoneLandscape(): boolean {
  const [on, setOn] = useState(sidewaysNow);
  useEffect(() => {
    const queries = [SIDEWAYS_QUERY, COARSE_QUERY].map((q) => window.matchMedia?.(q));
    const update = (): void => setOn(sidewaysNow());
    update();
    queries.forEach((mq) => mq?.addEventListener('change', update));
    return () => queries.forEach((mq) => mq?.removeEventListener('change', update));
  }, []);
  return on;
}
