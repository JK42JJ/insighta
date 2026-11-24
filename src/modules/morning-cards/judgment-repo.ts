/**
 * Judgment repository for the mobile morning cards (PRD #1788).
 * Validates input and writes exactly one row per call. Stores no transcript text.
 * The table DDL is a separate protected-path feature; the db surface is injected.
 */
import { MORNING_CARD_DOMAINS, type MorningCardDomainKey } from './domains';

export const MORNING_CARD_VERDICTS = ['useful', 'skip'] as const;
export type MorningCardVerdict = (typeof MORNING_CARD_VERDICTS)[number];

export const MORNING_CARD_REASON_TAGS = [
  'off-topic',
  'outdated',
  'promotional',
  'repetitive',
  'generic',
  'low-quality',
] as const;
export type MorningCardReasonTag = (typeof MORNING_CARD_REASON_TAGS)[number];

/** Upper bound for the shown position (cards per domain are far fewer). */
export const MORNING_CARD_MAX_POSITION = 1000;
const YOUTUBE_VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export interface JudgmentInput {
  user_id: string;
  video_id: string;
  domain: string;
  verdict: string;
  shown_position: number;
  reason_tags?: string[];
}

export interface JudgmentRow {
  user_id: string;
  video_id: string;
  domain: MorningCardDomainKey;
  verdict: MorningCardVerdict;
  reason_tags: MorningCardReasonTag[];
  shown_position: number;
}

export interface JudgmentDb {
  morning_card_judgments: {
    create(args: { data: JudgmentRow }): Promise<unknown>;
  };
}

export class JudgmentValidationError extends Error {}

export function isReasonTag(v: unknown): v is MorningCardReasonTag {
  return typeof v === 'string' && (MORNING_CARD_REASON_TAGS as readonly string[]).includes(v);
}

export function validateJudgment(input: JudgmentInput): JudgmentRow {
  if (!input.user_id) throw new JudgmentValidationError('user_id required');
  if (!YOUTUBE_VIDEO_ID_RE.test(input.video_id ?? '')) {
    throw new JudgmentValidationError('invalid video_id');
  }
  if (!Object.prototype.hasOwnProperty.call(MORNING_CARD_DOMAINS, input.domain)) {
    throw new JudgmentValidationError('unknown domain');
  }
  if (!(MORNING_CARD_VERDICTS as readonly string[]).includes(input.verdict)) {
    throw new JudgmentValidationError('unknown verdict');
  }
  const pos = input.shown_position;
  if (!Number.isInteger(pos) || pos < 0 || pos > MORNING_CARD_MAX_POSITION) {
    throw new JudgmentValidationError('invalid shown_position');
  }
  const tags = input.reason_tags ?? [];
  if (!tags.every(isReasonTag)) throw new JudgmentValidationError('unknown reason tag');
  return {
    user_id: input.user_id,
    video_id: input.video_id,
    domain: input.domain as MorningCardDomainKey,
    verdict: input.verdict as MorningCardVerdict,
    reason_tags: [...new Set(tags)] as MorningCardReasonTag[],
    shown_position: pos,
  };
}

export async function saveJudgment(db: JudgmentDb, input: JudgmentInput): Promise<JudgmentRow> {
  const data = validateJudgment(input);
  await db.morning_card_judgments.create({ data });
  return data;
}

/** Db surface for the PC review list (read verdicts, update reason tags). */
export interface JudgmentReviewDb {
  morning_card_judgments: {
    findMany(args: {
      where: { user_id: string; domain: string };
      orderBy: { created_at: 'desc' };
    }): Promise<Array<{ video_id: string; verdict: string; reason_tags: string[] }>>;
    updateMany(args: {
      where: { user_id: string; video_id: string; domain: string };
      data: { reason_tags: MorningCardReasonTag[] };
    }): Promise<{ count: number }>;
  };
}

export interface SavedVerdict {
  verdict: string;
  reason_tags: string[];
}

/** Latest saved verdict per video for one user and domain. */
export async function loadVerdictsByVideo(
  db: JudgmentReviewDb,
  userId: string,
  domain: string
): Promise<Map<string, SavedVerdict>> {
  const rows = await db.morning_card_judgments.findMany({
    where: { user_id: userId, domain },
    orderBy: { created_at: 'desc' },
  });
  const out = new Map<string, SavedVerdict>();
  for (const r of rows) {
    // Rows are newest first; keep the first one seen per video.
    if (!out.has(r.video_id)) {
      out.set(r.video_id, { verdict: r.verdict, reason_tags: r.reason_tags });
    }
  }
  return out;
}

/** Sets reason tags on an existing judgment. Returns false when none matched. */
export async function setReasonTags(
  db: JudgmentReviewDb,
  input: { user_id: string; video_id: string; domain: string; reason_tags: unknown }
): Promise<boolean> {
  if (!YOUTUBE_VIDEO_ID_RE.test(input.video_id ?? '')) {
    throw new JudgmentValidationError('invalid video_id');
  }
  if (!Object.prototype.hasOwnProperty.call(MORNING_CARD_DOMAINS, input.domain)) {
    throw new JudgmentValidationError('unknown domain');
  }
  const tags = input.reason_tags;
  if (!Array.isArray(tags) || !tags.every(isReasonTag)) {
    throw new JudgmentValidationError('unknown reason tag');
  }
  const res = await db.morning_card_judgments.updateMany({
    where: { user_id: input.user_id, video_id: input.video_id, domain: input.domain },
    data: { reason_tags: [...new Set(tags)] },
  });
  return res.count > 0;
}
