import { useEffect, useState } from 'react';

/*
 * A phone held sideways (decision 2026-11-14): the watch screen then shows only the player,
 * as large as the screen allows, and moving between videos waits until the phone is upright.
 * iPhone Safari can neither lock the orientation nor put an element in fullscreen, so the page
 * rotates and only its layout can change. Desktop windows are landscape too: the touch pointer
 * and the short height keep them out.
 */
export const PHONE_LANDSCAPE_QUERY =
  '(orientation: landscape) and (pointer: coarse) and (max-height: 540px)';

export function usePhoneLandscape(): boolean {
  const [on, setOn] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia?.(PHONE_LANDSCAPE_QUERY).matches
  );
  useEffect(() => {
    const mq = window.matchMedia?.(PHONE_LANDSCAPE_QUERY);
    if (!mq) return undefined;
    const update = (): void => setOn(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return on;
}
