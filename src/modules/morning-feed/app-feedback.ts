/**
 * Comments people send from the app (decision R30 + work order B4, 2026-11-25): the account sheet's
 * one-line comment ('menu') and the line under a brief ('brief'). morning_app_feedback is written
 * only here, and only by INSERT. The comment text is never logged; the notify broker reads the rows
 * (docs/ops/app-feedback-notify.md).
 */
import { FeedValidationError, isFeedCell, type FeedDb } from '@/modules/morning-feed/feed';
import { isRealDate } from '@/modules/morning-feed/pages';

export const APP_FEEDBACK_KINDS = ['menu', 'brief'] as const;
export type AppFeedbackKind = (typeof APP_FEEDBACK_KINDS)[number];

export const APP_FEEDBACK_BODY_MAX = 2000;
/** Comments one account may send in 24 hours. */
export const APP_FEEDBACK_DAILY_MAX = 20;
/** Request size: 2,000 characters of text plus the context fields. */
export const APP_FEEDBACK_BODY_LIMIT_BYTES = 16 * 1024;

const PATH_MAX = 200;
const DEVICE_MAX = 200;
const REPLAY_URL_MAX = 500;
const SCREEN_RE = /^[a-z][a-z0-9_-]{0,31}$/;
/** An address inside the app: one leading slash, no host, no spaces. */
const PATH_RE = /^\/(?!\/)[\w\-./?=&%]*$/;
const REPLAY_PATH_RE = /^\/project\/[\w-]+\/replay\/[\w-]+$/;
/** Control characters and line breaks: the comment is one line. */
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f\u2028\u2029]+/g;

export interface AppFeedbackInput {
  kind: AppFeedbackKind;
  body: string;
  screen: string | null;
  path: string | null;
  cell: string | null;
  seen_date: string | null;
  replay_url: string | null;
}

/** A session replay address as posthog-js builds it, else null (the comment is kept without it). */
export function replayUrlOrNull(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > REPLAY_URL_MAX) return null;
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.port !== '') return null;
  if (!url.hostname.endsWith('.posthog.com')) return null;
  return REPLAY_PATH_RE.test(url.pathname) ? url.href : null;
}

/**
 * Validates a request body. Only the kind and the comment can refuse it; where it was sent from is
 * context, so a context field that does not fit becomes null and the comment is still kept.
 * @throws FeedValidationError
 */
export function validateAppFeedback(body: unknown): AppFeedbackInput {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const kind = b['kind'];
  if (!(APP_FEEDBACK_KINDS as readonly unknown[]).includes(kind)) {
    throw new FeedValidationError('invalid kind');
  }
  if (typeof b['body'] !== 'string') throw new FeedValidationError('invalid body');
  const text = b['body'].replace(CONTROL_RE, ' ').trim();
  if (text === '' || text.length > APP_FEEDBACK_BODY_MAX) {
    throw new FeedValidationError('invalid body');
  }
  const cell = isFeedCell(b['cell']) ? b['cell'] : null;
  const seenDate = isRealDate(b['date']) ? b['date'] : null;
  if (kind === 'brief' && (cell === null || seenDate === null)) {
    throw new FeedValidationError('brief required');
  }
  const screen = b['screen'];
  const path = b['path'];
  return {
    kind: kind as AppFeedbackKind,
    body: text,
    screen: typeof screen === 'string' && SCREEN_RE.test(screen) ? screen : null,
    path: typeof path === 'string' && path.length <= PATH_MAX && PATH_RE.test(path) ? path : null,
    cell,
    seen_date: seenDate,
    replay_url: replayUrlOrNull(b['replay_url']),
  };
}

/** The sending browser (User-Agent), cut to the column. */
export function deviceOf(userAgent: string | undefined): string | null {
  const ua = (userAgent ?? '').replace(CONTROL_RE, ' ').trim();
  return ua === '' ? null : ua.slice(0, DEVICE_MAX);
}

/**
 * Appends one comment. False = this account already sent APP_FEEDBACK_DAILY_MAX in 24 hours and
 * nothing was written. The brief's owner is stored only when the comment names a brief.
 */
export async function saveAppFeedback(
  db: FeedDb,
  userId: string,
  ownerId: string,
  input: AppFeedbackInput,
  device: string | null
): Promise<boolean> {
  if (!userId) throw new FeedValidationError('user_id required');
  const hasBrief = input.cell !== null && input.seen_date !== null;
  const written = await db.$executeRawUnsafe(
    `INSERT INTO public.morning_app_feedback
       (user_id, kind, body, screen, path, brief_owner_id, cell, seen_date, device, replay_url)
     SELECT $1::uuid, $2::varchar, $3::text, $4::varchar, $5::varchar, $6::uuid, $7::varchar,
            $8::date, $9::varchar, $10::varchar
      WHERE (SELECT count(*) FROM public.morning_app_feedback
              WHERE user_id = $1::uuid AND created_at > now() - interval '24 hours') < $11::int`,
    userId,
    input.kind,
    input.body,
    input.screen,
    input.path,
    hasBrief ? ownerId : null,
    input.cell,
    input.seen_date,
    device,
    input.replay_url,
    APP_FEEDBACK_DAILY_MAX
  );
  return written > 0;
}
