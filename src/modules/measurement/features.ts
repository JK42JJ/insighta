/**
 * Pure feature calculators for the measurement record (SHADOW MODE).
 * No I/O. `now` is injectable for deterministic tests.
 */
import { MS_PER_DAY, SECONDS_PER_MINUTE, MINUTES_PER_HOUR } from '@/utils/time-constants';
import { titleShape } from './title-shape';
import type { ReactionFeatures, VideoFeatures, VideoItemLike } from './types';

/** Minimum age (days) used as the views_per_day divisor. */
export const MIN_AGE_DAYS_FOR_RATE = 1;

const SECONDS_PER_HOUR = SECONDS_PER_MINUTE * MINUTES_PER_HOUR;
const ISO_DURATION_RE = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;
/** Line starting (after bullets/punctuation) with m:ss / mm:ss / h:mm:ss. */
const CHAPTER_LINE_RE = /^\W*(?:\d{1,2}:)?\d{1,2}:\d{2}(?![\d:])/;

const SECONDS_PER_DAY = 24 * SECONDS_PER_HOUR;

/** ISO 8601 duration (PT1H2M3S) to seconds; null when unparsable. */
export function parseIsoDurationSec(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const m = ISO_DURATION_RE.exec(iso);
  if (!m) return null;
  const [, d, h, mi, s] = m;
  return (
    Number(d ?? 0) * SECONDS_PER_DAY +
    Number(h ?? 0) * SECONDS_PER_HOUR +
    Number(mi ?? 0) * SECONDS_PER_MINUTE +
    Number(s ?? 0)
  );
}

/** Whole days since `iso` (floored, never negative); null when invalid. */
export function ageDays(iso: string | null | undefined, now: Date = new Date()): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / MS_PER_DAY));
}

/** Count description lines that start with a timestamp (0:00 / 12:34 / 1:02:03). */
export function countChapters(description: string | null | undefined): number {
  if (!description) return 0;
  return description.split(/\r?\n/).filter((line) => CHAPTER_LINE_RE.test(line)).length;
}

function toNum(v: string | number | null | undefined): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** a / b, null when a is null or b is not positive. */
export function safeRatio(a: number | null, b: number | null): number | null {
  if (a == null || b == null || b <= 0) return null;
  return a / b;
}

export function computeVideoFeatures(item: VideoItemLike, now: Date = new Date()): VideoFeatures {
  const desc = item.snippet?.description ?? '';
  return {
    age_days: ageDays(item.snippet?.publishedAt, now),
    duration_sec: parseIsoDurationSec(item.contentDetails?.duration),
    chapter_count: countChapters(desc),
    has_caption: item.contentDetails?.caption === 'true',
    definition: item.contentDetails?.definition ?? null,
    description_length: desc.length,
    title_shape: titleShape(item.snippet?.title),
  };
}

export function computeReactionFeatures(
  item: VideoItemLike,
  now: Date = new Date()
): ReactionFeatures {
  const views = toNum(item.statistics?.viewCount);
  const likes = toNum(item.statistics?.likeCount);
  const comments = toNum(item.statistics?.commentCount);
  const age = ageDays(item.snippet?.publishedAt, now);
  const divisor = age == null ? null : Math.max(age, MIN_AGE_DAYS_FOR_RATE);
  return {
    view_count: views,
    views_per_day: safeRatio(views, divisor),
    like_count: likes,
    comment_count: comments,
    like_per_view: safeRatio(likes, views),
    comment_per_view: safeRatio(comments, views),
  };
}
