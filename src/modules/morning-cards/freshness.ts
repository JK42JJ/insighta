/** Pure freshness decision. `now` is always a parameter; no clock reads. */
import { KST_OFFSET_HOURS } from '../../utils/kst';
import { MS_PER_DAY, MS_PER_HOUR } from '../../utils/time-constants';
import type { FreshnessClass, MorningCardsConfig } from './config';

const KST_OFFSET_MS = KST_OFFSET_HOURS * MS_PER_HOUR;
const JANUARY = 0;
const FEBRUARY = 1;

export interface FreshnessInput {
  publishedAt: string | Date | null | undefined;
  now: Date;
  freshnessClass: FreshnessClass;
  config: MorningCardsConfig;
}

export interface FreshnessResult {
  passed: boolean;
  reason: string;
  windowStart: string | null;
}

function parseDate(v: unknown): Date | null {
  const d = v instanceof Date ? v : typeof v === 'string' && v ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
}

/** Start of the time_bound window: Jan 1 00:00 KST, minus fallback months in Jan/Feb. */
function timeBoundStart(now: Date, fallbackMonths: number): Date {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  const month = kst.getUTCMonth();
  const back = month === JANUARY || month === FEBRUARY ? fallbackMonths : 0;
  // Date.UTC normalises negative months into the previous year.
  return new Date(Date.UTC(kst.getUTCFullYear(), JANUARY - back, 1) - KST_OFFSET_MS);
}

function windowStartFor(cls: FreshnessClass, now: Date, config: MorningCardsConfig): Date | null {
  const { fastDays, marketDays, evergreenDays } = config.windows;
  const daysBack = (d: number): Date => new Date(now.getTime() - d * MS_PER_DAY);
  if (cls === 'fast') return daysBack(fastDays);
  if (cls === 'market') return daysBack(marketDays);
  if (cls === 'time_bound') return timeBoundStart(now, config.timeBoundFallbackMonths);
  return evergreenDays === null ? null : daysBack(evergreenDays);
}

export function isFresh(input: FreshnessInput): FreshnessResult {
  const { now } = input;
  const start = windowStartFor(input.freshnessClass, now, input.config);
  const windowStart = start ? start.toISOString() : null;
  const published = parseDate(input.publishedAt);
  if (!published) return { passed: false, reason: 'invalid_published_at', windowStart };
  if (start && published.getTime() < start.getTime()) {
    return { passed: false, reason: 'outside_window', windowStart };
  }
  return { passed: true, reason: start ? 'within_window' : 'no_limit', windowStart };
}
