import { useEffect, useState, type RefObject } from 'react';

/*
 * How much of the app the on-screen keyboard covers, in px. iOS Safari (and Chrome on Android)
 * lay the keyboard over the page instead of shrinking it: only window.visualViewport gets smaller,
 * so a sheet at the bottom of the app would sit behind the keyboard.
 */

/** Less than this is a browser bar moving, not a keyboard. */
const KEYBOARD_MIN_PX = 80;

/** The part of the box's bottom edge that is under the visible viewport's bottom. */
export function keyboardInset(
  boxBottom: number,
  vv: { height: number; offsetTop: number; scale: number }
): number {
  if (vv.scale !== 1) return 0; // zoomed in: the visible part is small for another reason
  const covered = Math.round(boxBottom - (vv.offsetTop + vv.height));
  return covered >= KEYBOARD_MIN_PX ? covered : 0;
}

/** `inside`: any element inside the app box (.mf-w-app), whose bottom the keyboard covers. */
export function useKeyboardInset(inside: RefObject<HTMLElement>): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    const box = inside.current?.closest('.mf-w-app');
    if (!vv || !box) return undefined;
    const measure = (): void => setInset(keyboardInset(box.getBoundingClientRect().bottom, vv));
    measure();
    vv.addEventListener('resize', measure);
    vv.addEventListener('scroll', measure);
    return () => {
      vv.removeEventListener('resize', measure);
      vv.removeEventListener('scroll', measure);
    };
  }, [inside]);
  return inset;
}
