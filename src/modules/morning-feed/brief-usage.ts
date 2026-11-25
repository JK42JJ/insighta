/**
 * Brief feedback and usage events (stg user test, 2026-11-14). Both tables are written only here:
 * morning_brief_feedback (one row per viewer, cell, date; upsert) and morning_usage_events (append).
 */
import {
  FeedValidationError,
  isFeedCell,
  isShownCell,
  kstDayString,
  type FeedDb,
} from '@/modules/morning-feed/feed';
import { isRealDate } from '@/modules/morning-feed/pages';
import { MS_PER_DAY } from '@/utils/time-constants';

export const BRIEF_FEEDBACK_VALUES = ['useful', 'not_useful'] as const;
export type BriefFeedbackValue = (typeof BRIEF_FEEDBACK_VALUES)[number];

export const USAGE_EVENT_KINDS = [
  'home_open',
  'brief_open',
  'evidence_open',
  'video_reaction',
  // a source's sheet over the article (2026-11-25): opened (value = body/note), whole seconds its
  // video played (value), gone to the full video screen, closed (value = how). Every tap on a
  // source, a switch inside the sheet included, stays one evidence_open.
  'source_sheet_open',
  'source_sheet_watch',
  'source_sheet_full',
  'source_sheet_close',
  // landing page (2026-11-24): kept in the visitor's tab and sent after sign-in with login_done
  'landing_open',
  // landing v4 (2026-11-24): dot reached (value s1..s6) and the scene-5 source tap
  'landing_scene',
  // 2026-11-25: one landing gesture, e.g. "ng_34_120" (direction + result, distance %, speed %)
  'landing_swipe',
  'source_click',
  // the replaced scroll landing; kept so tabs opened before the switch still send their events
  'landing_scroll_step3',
  'start_click',
  'add_click',
  'login_done',
] as const;
export type UsageEventKind = (typeof USAGE_EVENT_KINDS)[number];

/**
 * Brief behaviour events (work order D1, 2026-11-25): what a reader does, down to the sentence.
 * Same list as the app's BRIEF_EVENT_KINDS (frontend/src/shared/lib/brief-event-kinds.ts).
 */
export const BRIEF_EVENT_KINDS = [
  'headline_view',
  'headline_select',
  'read_depth',
  'sentence_tap',
  'play_range',
  'video_full',
  'reaction',
  'share',
  'suggest',
  'field_switch',
  'past_open',
  'other_fields_view',
  'other_field_select',
] as const;
export type BriefEventKind = (typeof BRIEF_EVENT_KINDS)[number];

/** Same shape as a YouTube id; matches varchar(32) with room. */
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
/** Free value of an event (e.g. a verdict); short token only. */
const EVENT_VALUE_RE = /^[A-Za-z0-9_-]{1,16}$/;
/** p<paragraph>.s<sentence>; matches varchar(16) with room. */
const SENTENCE_ID_RE = /^p\d{1,3}\.s\d{1,3}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PARAGRAPH_MAX = 999;
/** Seconds into a video: a day is far over the longest one. */
const VIDEO_SEC_MAX = 24 * 60 * 60;
/** The phone's clock is believed this far; outside it the arrival time is the only one kept. */
const OCCURRED_PAST_MAX_MS = 7 * MS_PER_DAY;
const OCCURRED_FUTURE_MAX_MS = 5 * 60 * 1000;

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

export interface BriefEventInput {
  kind: BriefEventKind;
  cell: string | null;
  seen_date: string | null;
  video_id: string | null;
  value: string | null;
  sentence_id: string | null;
  paragraph: number | null;
  start_sec: number | null;
  end_sec: number | null;
  from_cell: string | null;
  to_cell: string | null;
  occurred_at: string | null;
  client_event_id: string | null;
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
  // a hidden cell's brief is not shown (MORNING_HIDDEN_CELLS), so it cannot be rated either
  if (!isShownCell(input.cell)) throw new FeedValidationError('unknown cell');
  if (!isRealDate(input.date)) throw new FeedValidationError('invalid date');
  if (!(BRIEF_FEEDBACK_VALUES as readonly unknown[]).includes(input.value)) {
    throw new FeedValidationError('invalid value');
  }
  if (input.date > kstDayString(now)) throw new FeedValidationError('brief is in the future');
  const exists = await db.$queryRawUnsafe<Array<{ one: number }>>(
    `SELECT 1 AS one FROM public.morning_pages
      WHERE user_id = $1::uuid AND cell = $2 AND seen_date = $3::date
        AND hidden_at IS NULL`,
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

export function isBriefEventKind(v: unknown): v is BriefEventKind {
  return (BRIEF_EVENT_KINDS as readonly unknown[]).includes(v);
}

function intOrNull(v: unknown, max: number): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max ? v : null;
}

function matchOrNull(v: unknown, re: RegExp): string | null {
  return typeof v === 'string' && re.test(v) ? v : null;
}

function occurredOrNull(v: unknown, now: Date): string | null {
  if (typeof v !== 'string' || v.length > 40) return null;
  const at = Date.parse(v);
  if (Number.isNaN(at)) return null;
  const late = now.getTime() - at;
  if (late > OCCURRED_PAST_MAX_MS || late < -OCCURRED_FUTURE_MAX_MS) return null;
  return new Date(at).toISOString();
}

/**
 * Validates a brief event body. Only the kind can refuse it: the rest says where it happened, so a
 * field that does not fit becomes null and the event is still kept (a refused event is lost data).
 * @throws FeedValidationError
 */
export function validateBriefEvent(body: unknown, now: Date = new Date()): BriefEventInput {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const kind = b['kind'];
  if (!isBriefEventKind(kind)) throw new FeedValidationError('invalid kind');
  let start = intOrNull(b['start_sec'], VIDEO_SEC_MAX);
  let end = intOrNull(b['end_sec'], VIDEO_SEC_MAX);
  if (start !== null && end !== null && end < start) start = end = null;
  return {
    kind,
    cell: isFeedCell(b['cell']) ? b['cell'] : null,
    seen_date: isRealDate(b['date']) ? b['date'] : null,
    video_id: matchOrNull(b['video_id'], VIDEO_ID_RE),
    value: matchOrNull(b['value'], EVENT_VALUE_RE),
    sentence_id: matchOrNull(b['sentence_id'], SENTENCE_ID_RE),
    paragraph: intOrNull(b['paragraph'], PARAGRAPH_MAX),
    start_sec: start,
    end_sec: end,
    from_cell: isFeedCell(b['from']) ? b['from'] : null,
    to_cell: isFeedCell(b['to']) ? b['to'] : null,
    occurred_at: occurredOrNull(b['at'], now),
    client_event_id: matchOrNull(b['id'], UUID_RE),
  };
}

/**
 * Appends one brief event for the viewer, once per client event id (the app sends an event again
 * when it cannot tell whether it arrived). `ownerId` + cell + date name the brief.
 */
export async function recordBriefEvent(
  db: FeedDb,
  userId: string,
  ownerId: string,
  event: BriefEventInput
): Promise<void> {
  if (!userId) throw new FeedValidationError('user_id required');
  const owner = event.cell !== null && event.seen_date !== null ? ownerId : null;
  await db.$executeRawUnsafe(
    `INSERT INTO public.morning_usage_events
       (user_id, kind, cell, seen_date, video_id, value, brief_owner_id, sentence_id, paragraph,
        start_sec, end_sec, from_cell, to_cell, occurred_at, client_event_id)
     SELECT $1::uuid, $2::varchar, $3::varchar, $4::date, $5::varchar, $6::varchar, $7::uuid,
            $8::varchar, $9::smallint, $10::integer, $11::integer, $12::varchar, $13::varchar,
            $14::timestamptz, $15::uuid
      WHERE NOT EXISTS (
        SELECT 1 FROM public.morning_usage_events
         WHERE client_event_id = $15::uuid AND user_id = $1::uuid
      )`,
    userId,
    event.kind,
    event.cell,
    event.seen_date,
    event.video_id,
    event.value,
    owner,
    event.sentence_id,
    event.paragraph,
    event.start_sec,
    event.end_sec,
    event.from_cell,
    event.to_cell,
    event.occurred_at,
    event.client_event_id
  );
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
