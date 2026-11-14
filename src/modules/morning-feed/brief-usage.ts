/**
 * Brief feedback and usage events (stg user test, 2026-11-14). Both tables are written only here:
 * morning_brief_feedback (one row per viewer, cell, date; upsert) and morning_usage_events (append).
 */
import {
  FeedValidationError,
  isFeedCell,
  kstDayString,
  type FeedDb,
} from '@/modules/morning-feed/feed';
import { isRealDate } from '@/modules/morning-feed/pages';

export const BRIEF_FEEDBACK_VALUES = ['useful', 'not_useful'] as const;
export type BriefFeedbackValue = (typeof BRIEF_FEEDBACK_VALUES)[number];

export const USAGE_EVENT_KINDS = [
  'home_open',
  'brief_open',
  'evidence_open',
  'video_reaction',
] as const;
export type UsageEventKind = (typeof USAGE_EVENT_KINDS)[number];

/** Same shape as a YouTube id; matches varchar(32) with room. */
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
/** Free value of an event (e.g. a verdict); short token only. */
const EVENT_VALUE_RE = /^[A-Za-z0-9_-]{1,16}$/;

export interface BriefFeedbackRow {
  cell: string;
  seen_date: string;
  value: BriefFeedbackValue;
}

export interface UsageEventInput {
  kind: UsageEventKind;
  cell: string | null;
  seen_date: string | null;
  video_id: string | null;
  value: string | null;
}

/** The viewer's feedback on one brief, or null. */
export async function readBriefFeedback(
  db: FeedDb,
  userId: string,
  cell: string,
  date: string
): Promise<BriefFeedbackValue | null> {
  const rows = await db.$queryRawUnsafe<Array<{ value: string }>>(
    `SELECT value FROM public.morning_brief_feedback
      WHERE user_id = $1::uuid AND cell = $2 AND seen_date = $3::date`,
    userId,
    cell,
    date
  );
  const v = rows[0]?.value;
  return v === 'useful' || v === 'not_useful' ? v : null;
}

/**
 * Upserts the viewer's feedback on the owner's brief (cell, date). The brief must exist and must
 * not be after today (`now`, KST).
 * @throws FeedValidationError on bad input, a future date or a missing brief.
 */
export async function saveBriefFeedback(
  db: FeedDb,
  userId: string,
  ownerId: string,
  input: { cell: unknown; date: unknown; value: unknown },
  now: Date = new Date()
): Promise<BriefFeedbackRow> {
  if (!userId) throw new FeedValidationError('user_id required');
  if (!isFeedCell(input.cell)) throw new FeedValidationError('unknown cell');
  if (!isRealDate(input.date)) throw new FeedValidationError('invalid date');
  if (!(BRIEF_FEEDBACK_VALUES as readonly unknown[]).includes(input.value)) {
    throw new FeedValidationError('invalid value');
  }
  if (input.date > kstDayString(now)) throw new FeedValidationError('brief is in the future');
  const exists = await db.$queryRawUnsafe<Array<{ one: number }>>(
    `SELECT 1 AS one FROM public.morning_pages
      WHERE user_id = $1::uuid AND cell = $2 AND seen_date = $3::date`,
    ownerId,
    input.cell,
    input.date
  );
  if (exists.length === 0) throw new FeedValidationError('brief not found');
  await db.$executeRawUnsafe(
    `INSERT INTO public.morning_brief_feedback (user_id, cell, seen_date, value)
     VALUES ($1::uuid, $2, $3::date, $4)
     ON CONFLICT (user_id, cell, seen_date)
     DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    userId,
    input.cell,
    input.date,
    input.value
  );
  return { cell: input.cell, seen_date: input.date, value: input.value as BriefFeedbackValue };
}

/** Validates an event body; optional fields become null. @throws FeedValidationError */
export function validateUsageEvent(body: unknown): UsageEventInput {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  if (!(USAGE_EVENT_KINDS as readonly unknown[]).includes(b['kind'])) {
    throw new FeedValidationError('invalid kind');
  }
  const opt = (k: string): unknown => (b[k] === undefined || b[k] === null ? null : b[k]);
  const cell = opt('cell');
  if (cell !== null && !isFeedCell(cell)) throw new FeedValidationError('unknown cell');
  const date = opt('date');
  if (date !== null && !isRealDate(date)) throw new FeedValidationError('invalid date');
  const videoId = opt('video_id');
  if (videoId !== null && !(typeof videoId === 'string' && VIDEO_ID_RE.test(videoId))) {
    throw new FeedValidationError('invalid video_id');
  }
  const value = opt('value');
  if (value !== null && !(typeof value === 'string' && EVENT_VALUE_RE.test(value))) {
    throw new FeedValidationError('invalid value');
  }
  return {
    kind: b['kind'] as UsageEventKind,
    cell: cell,
    seen_date: date,
    video_id: videoId,
    value: value,
  };
}

/** Appends one usage event for the viewer. */
export async function recordUsageEvent(
  db: FeedDb,
  userId: string,
  event: UsageEventInput
): Promise<void> {
  if (!userId) throw new FeedValidationError('user_id required');
  await db.$executeRawUnsafe(
    `INSERT INTO public.morning_usage_events (user_id, kind, cell, seen_date, video_id, value)
     VALUES ($1::uuid, $2, $3, $4::date, $5, $6)`,
    userId,
    event.kind,
    event.cell,
    event.seen_date,
    event.video_id,
    event.value
  );
}
