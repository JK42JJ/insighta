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

/** The home's one button (decision 2026-11-14 user test): always the shown brief. */
export const HOME_BUTTON_LABEL = '브리프 읽기';

/**
 * A brief's date (decision 2026-11-14 user test): the date only, '11월 13일'; a brief of today
 * reads '오늘 · 11월 16일'. '' if invalid.
 */
export function briefDateLabel(day: string, today: string): string {
  const m = DAY_RE.exec(day);
  if (!m) return '';
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime()) || d.getUTCDate() !== Number(m[3])) return '';
  const label = d.getUTCMonth() + 1 + '월 ' + d.getUTCDate() + '일';
  return day === today ? '오늘 · ' + label : label;
}

/** Colour of the home's ground per domain (design "Insighta App Prototype", 2026-11-25); drawn in watch-home.css. */
const HOME_TINTS: Readonly<Record<string, string>> = {
  '기술/개발': 'tech',
  '비즈니스/커리어': 'biz',
  '재테크/투자': 'fin',
  '학습/교육': 'learn',
  '건강/피트니스': 'health',
  '인간관계/커뮤니티': 'rel',
  '창작/예술': 'art',
  '라이프스타일/여행': 'life',
};
/** The domain's colour name; a domain without one has the plain ground. */
export function homeTint(cell: string): string | undefined {
  return HOME_TINTS[cell];
}

/** The domain `steps` further among those with a brief, in chip order, round again; null = only this one. */
export function nextWithPage(
  cells: string[],
  pages: Record<string, unknown>,
  from: string,
  steps = 1
): string | null {
  const open = cells.filter((c) => c in pages);
  if (open.length === 0) return null;
  const to = open[(Math.max(0, open.indexOf(from)) + steps) % open.length];
  return to === undefined || to === from ? null : to;
}
