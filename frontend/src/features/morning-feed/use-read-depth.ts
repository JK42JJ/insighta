import { useEffect, useRef, type RefObject } from 'react';

/*
 * How far a brief was read (order 2026-11-25 D1, "문단 단위"): a paragraph counts once its end is in
 * or above the view when the scrolling has rested for a moment. Each paragraph once per opening.
 */

export const READ_REST_MS = 1000;
const PARAGRAPH = '[data-para]';

/** @param covered how much of the lower edge the source sheet covers (px): not in view */
export function useReadDepth(
  scroll: RefObject<HTMLElement>,
  ready: boolean,
  covered: number,
  onRead: (paragraph: number) => void
): void {
  const read = useRef(new Set<number>());
  const cb = useRef(onRead);
  cb.current = onRead;
  const room = useRef(covered);
  room.current = covered;
  useEffect(() => {
    const box = scroll.current;
    if (!box || !ready) return undefined;
    let timer: number | null = null;
    const look = (): void => {
      const view = box.getBoundingClientRect();
      // covered or not laid out: nothing is in view
      if (view.height === 0) return;
      box.querySelectorAll<HTMLElement>(PARAGRAPH).forEach((el) => {
        const n = Number(el.dataset.para);
        // a folded note's paragraphs are not shown
        if (read.current.has(n) || el.closest('[data-folded]')) return;
        if (el.getBoundingClientRect().bottom > view.bottom - room.current) return;
        read.current.add(n);
        cb.current(n);
      });
    };
    const rest = (): void => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(look, READ_REST_MS);
    };
    rest();
    box.addEventListener('scroll', rest, { passive: true });
    box.addEventListener('click', rest);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      box.removeEventListener('scroll', rest);
      box.removeEventListener('click', rest);
    };
  }, [scroll, ready]);
}
