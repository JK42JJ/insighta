import { useEffect, type RefObject } from 'react';

/*
 * Pressed look at the moment the finger lands (decision 2026-11-14), for every element marked
 * [data-press] under the root: pointerdown sets [data-pressed]; release, the finger moving off
 * the element, a cancel (the browser took the touch for a scroll) or any scroll removes it.
 * motion.css draws the look per kind. One listener set on the app root covers every screen.
 */

/** How far (px) the finger may leave the element's box before the pressed look is dropped. */
const LEAVE_SLOP_PX = 10;

export const PRESS_SELECTOR = '[data-press]';

export function isPressDisabled(el: Element): boolean {
  return (
    (el as HTMLButtonElement).disabled === true ||
    el.getAttribute('aria-disabled') === 'true' ||
    el.hasAttribute('data-press-off')
  );
}

export function usePressFeedback(root: RefObject<HTMLElement>): void {
  useEffect(() => {
    const host = root.current;
    if (!host) return undefined;
    let pressed: { el: HTMLElement; id: number; box: DOMRect } | null = null;

    const release = (): void => {
      if (!pressed) return;
      pressed.el.removeAttribute('data-pressed');
      pressed = null;
    };
    const onDown = (e: PointerEvent): void => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      release();
      const el = (e.target as Element | null)?.closest?.(PRESS_SELECTOR) as HTMLElement | null;
      if (!el || !host.contains(el) || isPressDisabled(el)) return;
      el.setAttribute('data-pressed', '');
      pressed = { el, id: e.pointerId, box: el.getBoundingClientRect() };
    };
    const onMove = (e: PointerEvent): void => {
      if (!pressed || e.pointerId !== pressed.id) return;
      const b = pressed.box;
      const out =
        e.clientX < b.left - LEAVE_SLOP_PX ||
        e.clientX > b.right + LEAVE_SLOP_PX ||
        e.clientY < b.top - LEAVE_SLOP_PX ||
        e.clientY > b.bottom + LEAVE_SLOP_PX;
      if (out) release();
    };
    const onEnd = (e: PointerEvent): void => {
      if (pressed && e.pointerId === pressed.id) release();
    };

    // a link or a picture is never dragged out of the screen
    const noDrag = (e: DragEvent): void => e.preventDefault();
    host.addEventListener('dragstart', noDrag, { capture: true });
    host.addEventListener('pointerdown', onDown, { capture: true, passive: true });
    window.addEventListener('pointermove', onMove, { capture: true, passive: true });
    window.addEventListener('pointerup', onEnd, { capture: true, passive: true });
    window.addEventListener('pointercancel', onEnd, { capture: true, passive: true });
    // a scroll anywhere under the root means the touch was not a press
    host.addEventListener('scroll', release, { capture: true, passive: true });
    window.addEventListener('blur', release);
    return () => {
      release();
      host.removeEventListener('dragstart', noDrag, { capture: true });
      host.removeEventListener('pointerdown', onDown, { capture: true });
      window.removeEventListener('pointermove', onMove, { capture: true });
      window.removeEventListener('pointerup', onEnd, { capture: true });
      window.removeEventListener('pointercancel', onEnd, { capture: true });
      host.removeEventListener('scroll', release, { capture: true });
      window.removeEventListener('blur', release);
    };
  }, [root]);
}
