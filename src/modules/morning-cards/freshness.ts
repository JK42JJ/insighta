/**
 * Pure freshness decision. `now` is always a parameter; no clock reads.
 */

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
  /** ISO string, or null for no limit. */
  windowStart: string | null;
}

function parseDate(v: unknown): Date | null {
  if (v === null || v === undefined || v === '') return null;
  const d = v instanceof Date ? v : typeof v === 'string' ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
}

/** Start instant of the time_bound window for `now` (KST calendar). */
export function timeBoundWindowStart(now: Date, fallbackMonths: number): Date {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  const year = kst.getUTCFullYear();
  const month = kst.getUTCMonth();
  const back = month === JANUARY || month === FEBRUARY ? fallbackMonths : 0;
  // Date.UTC normalises negative months into the previous year.
  return new Date(Date.UTC(year, JANUARY - back, 1) - KST_OFFSET_MS);
}

/** Window start for a class, or null when unlimited. */
export function windowStartFor(
  freshnessClass: FreshnessClass,
  now: Date,
  config: MorningCardsConfig
): Date | null {
  switch (freshnessClass) {
    case 'fast':
      return new Date(now.getTime() - config.windows.fastDays * MS_PER_DAY);
    case 'market':
      return new Date(now.getTime() - config.windows.marketDays * MS_PER_DAY);
    case 'evergreen':
      return config.windows.evergreenDays === null
        ? null
        : new Date(now.getTime() - config.windows.evergreenDays * MS_PER_DAY);
    case 'time_bound':
      return timeBoundWindowStart(now, config.timeBoundFallbackMonths);
    default:
      return null;
  }
}

export function isFresh(input: FreshnessInput): FreshnessResult {
  const { now, freshnessClass, config } = input;
  const nowOk = parseDate(now);
  if (!nowOk) return { passed: false, reason: 'invalid_now', windowStart: null };
  if (!(FRESHNESS_KNOWN as readonly string[]).includes(freshnessClass)) {
    return { passed: false, reason: 'unknown_freshness_class', windowStart: null };
  }
  const start = windowStartFor(freshnessClass, nowOk, config);
  const windowStart = start ? start.toISOString() : null;
  const published = parseDate(input.publishedAt);
  if (!published) return { passed: false, reason: 'invalid_published_at', windowStart };
  if (start && published.getTime() < start.getTime()) {
    return { passed: false, reason: 'outside_window', windowStart };
  }
  return { passed: true, reason: start ? 'within_window' : 'no_limit', windowStart };
}

const FRESHNESS_KNOWN = ['fast', 'market', 'evergreen', 'time_bound'] as const;
