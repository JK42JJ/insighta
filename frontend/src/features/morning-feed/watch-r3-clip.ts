/*
 * Card text tap (2026-11-14): the 더 보기 button is gone; tapping the card's text opens the same
 * panel, but only when the card does not already show everything. A card hides text in two ways:
 * a block cut by its line limit (고른 이유, 제목, 한 줄 요약), or a whole block left out for room.
 */

export interface CardTextShown {
  why: string;
  summary: string;
  chapters: number;
  showWhy: boolean;
  showSummary: boolean;
  chapterRows: number;
}

/** Text blocks whose height is limited on the card (line clamp). */
export const CLAMPED_TEXT_SELECTOR = '.mf-w3-why-t, .mf-w3-title, .mf-w3-sum-t';
/** Sub-pixel rounding between scrollHeight and clientHeight is not a cut. */
const CLIP_TOLERANCE_PX = 1;

/** A block or part of the chapter list exists in the data but is not drawn on the card. */
export function leftOut(c: CardTextShown): boolean {
  return (
    (!!c.why && !c.showWhy) ||
    (!!c.summary && !c.showSummary) ||
    c.chapters > Math.max(0, c.chapterRows)
  );
}

/** Any clamped block inside `card` is cut (its content is taller than its box). */
export function cutInside(card: Element): boolean {
  return Array.from(card.querySelectorAll<HTMLElement>(CLAMPED_TEXT_SELECTOR)).some(
    (el) => el.scrollHeight - el.clientHeight > CLIP_TOLERANCE_PX
  );
}
