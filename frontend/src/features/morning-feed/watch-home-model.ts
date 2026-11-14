/*
 * Daily home (design handoff "design_handoff_insighta_home", README §헤드라인), pure and unit
 * tested: the headline size from its length and the screen width, and the seen-date text.
 */

/** Widths are computed between these (README: "430보다 넓은 화면은 430으로 계산"). */
export const HOME_MIN_W = 320;
export const HOME_MAX_W = 430;
/** Left and right margins together (22 + 22). */
const SIDE_PX = 44;
/** At or below this many non-space characters the short tier applies. */
const SHORT_MAX_CHARS = 24;
const TIERS = {
  short: { per: 8.45, track: -0.04, lh: 1.22 },
  long: { per: 9.1, track: -0.035, lh: 1.24 },
} as const;
/** Font sizes are rounded to this step. */
const ROUND_STEP = 0.5;

export interface HeadlineSize {
  fontPx: number;
  trackEm: number;
  lineHeight: number;
}

/** Headline size: (width − 44) ÷ characters per line, to 0.5 px; width clamped to 320..430. */
export function headlineSize(width: number, text: string): HeadlineSize {
  const w = Math.min(HOME_MAX_W, Math.max(HOME_MIN_W, width));
  const t = text.replace(/\s/g, '').length <= SHORT_MAX_CHARS ? TIERS.short : TIERS.long;
  return {
    fontPx: Math.round((w - SIDE_PX) / t.per / ROUND_STEP) * ROUND_STEP,
    trackEm: t.track,
    lineHeight: t.lh,
  };
}

const WEEKDAYS = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'] as const;
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** '2026-11-13' -> '11월 13일 금요일' (the calendar date as written, no time zone). '' if invalid. */
export function seenDateLabel(day: string): string {
  const m = DAY_RE.exec(day);
  if (!m) return '';
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime()) || d.getUTCDate() !== Number(m[3])) return '';
  return d.getUTCMonth() + 1 + '월 ' + d.getUTCDate() + '일 ' + WEEKDAYS[d.getUTCDay()];
}

/** 지난 장 목록 headline (page README): (width − 44) ÷ 16.5, to 0.5 px; 320 -> 16.5, 390 -> 21, 430 -> 23.5. */
const PAST_PER_LINE = 16.5;
export function pastHeadlinePx(width: number): number {
  const w = Math.min(HOME_MAX_W, Math.max(HOME_MIN_W, width));
  return Math.round((w - SIDE_PX) / PAST_PER_LINE / ROUND_STEP) * ROUND_STEP;
}
