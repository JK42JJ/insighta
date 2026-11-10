/**
 * Morning feed (오늘의 픽): which cards each cell shows, and how a judgment is saved or undone.
 * Reads the existing video pool plus the annotation table (cell, focus, one-line reason).
 * Nothing here deletes a row: undo sets a cancel marker (rule 4).
 */

export interface FeedCellDef {
  /** Pool tag label (also the cell name stored with a judgment). */
  label: string;
  /** Short name shown on the screen. */
  short: string;
  /** -1 = the "today, all cells" centre cell. */
  dom: number;
  /** Upload window in days; null = this calendar year (UTC). */
  windowDays: number | null;
}

/** SPEC section 7: nine positions, the centre is "오늘 전체". */
export const FEED_CELLS: readonly FeedCellDef[] = Object.freeze([
  { label: '기술/개발', short: '기술·개발', dom: 0, windowDays: 30 },
  { label: '비즈니스/커리어', short: '비즈니스', dom: 0, windowDays: null },
  { label: '재테크/투자', short: '재테크', dom: 0, windowDays: null },
  { label: '학습/교육', short: '학습', dom: 0, windowDays: null },
  { label: '오늘 전체', short: '오늘 전체', dom: -1, windowDays: null },
  { label: '건강/피트니스', short: '건강', dom: 0, windowDays: null },
  { label: '인간관계/커뮤니티', short: '인간관계', dom: 0, windowDays: null },
  { label: '창작/예술', short: '창작', dom: 0, windowDays: null },
  { label: '라이프스타일/여행', short: '라이프', dom: 0, windowDays: null },
]);

export const FEED_MAX_CARDS_PER_CELL = 15;
export const FEED_MIN_DURATION_SEC = 180;
export const FEED_MAX_POSITION = 1000;
const YOUTUBE_VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
/** useful = like, skip = dislike (X), pass = the card was replaced without a judgment. */
export const FEED_VERDICTS = ['useful', 'skip', 'pass'] as const;

import { MS_PER_DAY, MS_PER_HOUR } from '@/utils/time-constants';

export interface FeedDb {
  $queryRawUnsafe<T = unknown>(sql: string, ...params: unknown[]): Promise<T>;
  $executeRawUnsafe(sql: string, ...params: unknown[]): Promise<number>;
}

export interface FeedCard {
  video_id: string;
  title: string;
  channel: string | null;
  published_at: string;
  duration: number;
  view_count: number | null;
  thumbnail_url: string | null;
  cell: string;
  focus: string[];
  why: string;
  info?: FeedCardInfo;
}

export interface FeedChapter {
  sec: number;
  title: string;
}

/** Optional info items for a card; every field is present only when known. */
export interface FeedCardInfo {
  one_liner?: string;
  reason?: string;
  audio_language?: string;
  link_count?: number;
  chapters?: FeedChapter[];
}

interface FeedRow {
  cell: string;
  focus: string[] | null;
  why: string;
  judge_score: number | null;
  video_id: string;
  title: string;
  channel_name: string | null;
  published_at: Date;
  duration_seconds: number;
  thumbnail_url: string | null;
  view_count: bigint | number | null;
  info_one_liner?: string | null;
  info_reason?: string | null;
  info_audio_language?: string | null;
  info_link_count?: number | null;
  info_chapters?: unknown;
}

export class FeedValidationError extends Error {}

export function isFeedCell(label: unknown): label is string {
  return typeof label === 'string' && FEED_CELLS.some((c) => c.dom !== -1 && c.label === label);
}

function windowStart(cell: FeedCellDef, now: Date): Date {
  return cell.windowDays === null
    ? new Date(Date.UTC(now.getUTCFullYear(), 0, 1))
    : new Date(now.getTime() - cell.windowDays * MS_PER_DAY);
}

function buildInfo(r: FeedRow): FeedCardInfo | undefined {
  const info: FeedCardInfo = {};
  if (r.info_one_liner) info.one_liner = r.info_one_liner;
  if (r.info_reason) info.reason = r.info_reason;
  if (r.info_audio_language) info.audio_language = r.info_audio_language;
  if (typeof r.info_link_count === 'number') info.link_count = r.info_link_count;
  if (Array.isArray(r.info_chapters)) {
    const chapters: FeedChapter[] = [];
    for (const c of r.info_chapters as Array<Record<string, unknown>>) {
      if (c && Number.isInteger(c['sec']) && typeof c['title'] === 'string' && c['title']) {
        chapters.push({ sec: c['sec'] as number, title: c['title'] });
      }
    }
    if (chapters.length > 0) info.chapters = chapters;
  }
  return Object.keys(info).length > 0 ? info : undefined;
}

function viewsPerDay(row: FeedRow, now: Date): number {
  const views = Number(row.view_count ?? 0);
  const days = Math.max(1, (now.getTime() - new Date(row.published_at).getTime()) / MS_PER_DAY);
  return views / days;
}

/**
 * Cards for the screen: per cell, annotated and active videos inside the cell's upload window,
 * at least 3 minutes long, not already judged by this user. Order: judge score, then views per
 * day (an ordering signal only, never an exclusion), then newest. The centre cell has no cards
 * of its own (the screen shows all cells there).
 */
export async function fetchFeed(
  db: FeedDb,
  userId: string,
  now: Date = new Date()
): Promise<{ cells: FeedCellDef[]; cards: FeedCard[] }> {
  const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const earliest = new Date(
    Math.min(
      yearStart.getTime(),
      ...FEED_CELLS.filter((c) => c.windowDays !== null).map((c) => windowStart(c, now).getTime())
    )
  );
  const rows = await db.$queryRawUnsafe<FeedRow[]>(
    `SELECT a.cell, a.focus, a.why, a.judge_score, v.video_id, v.title, v.channel_name, v.published_at,
            v.duration_seconds, v.thumbnail_url, v.view_count,
            COALESCE(NULLIF(i.one_liner, ''), NULLIF(r.one_liner, '')) AS info_one_liner,
            i.reason AS info_reason, i.audio_language AS info_audio_language,
            i.link_count AS info_link_count, i.chapters AS info_chapters
       FROM public.morning_feed_annotations a
       JOIN public.video_pool v ON v.video_id = a.video_id
       LEFT JOIN public.morning_feed_card_info i ON i.video_id = a.video_id AND i.expires_at > now()
       LEFT JOIN public.video_rich_summaries r ON r.video_id = a.video_id
      WHERE v.is_active = true AND a.why IS NOT NULL AND v.duration_seconds >= $1
        AND v.published_at >= $2
        AND NOT EXISTS (
          SELECT 1 FROM public.morning_card_judgments j
           WHERE j.user_id = $3::uuid AND j.video_id = a.video_id AND j.cell IS NOT NULL AND j.canceled_at IS NULL)`,
    FEED_MIN_DURATION_SEC,
    earliest,
    userId
  );
  const cards: FeedCard[] = [];
  for (const cell of FEED_CELLS) {
    if (cell.dom === -1) continue;
    const start = windowStart(cell, now).getTime();
    const mine = rows
      .filter((r) => r.cell === cell.label && new Date(r.published_at).getTime() >= start)
      .sort(
        (a, b) =>
          (b.judge_score ?? -1) - (a.judge_score ?? -1) ||
          viewsPerDay(b, now) - viewsPerDay(a, now) ||
          new Date(b.published_at).getTime() - new Date(a.published_at).getTime()
      )
      .slice(0, FEED_MAX_CARDS_PER_CELL);
    for (const r of mine) {
      const info = buildInfo(r);
      cards.push({
        video_id: r.video_id,
        title: r.title,
        channel: r.channel_name,
        published_at: new Date(r.published_at).toISOString(),
        duration: r.duration_seconds,
        view_count: r.view_count == null ? null : Number(r.view_count),
        thumbnail_url: r.thumbnail_url,
        cell: r.cell,
        focus: r.focus ?? [],
        why: r.why,
        ...(info ? { info } : {}),
      });
    }
  }
  return { cells: [...FEED_CELLS], cards };
}

export interface FeedJudgmentInput {
  user_id: string;
  video_id: string;
  cell: string;
  verdict: string;
  shown_position: number;
}

export function validateFeedJudgment(input: FeedJudgmentInput): FeedJudgmentInput {
  if (!input.user_id) throw new FeedValidationError('user_id required');
  if (!YOUTUBE_VIDEO_ID_RE.test(input.video_id ?? ''))
    throw new FeedValidationError('invalid video_id');
  if (!isFeedCell(input.cell)) throw new FeedValidationError('unknown cell');
  if (!(FEED_VERDICTS as readonly string[]).includes(input.verdict)) {
    throw new FeedValidationError('unknown verdict');
  }
  const pos = input.shown_position;
  if (!Number.isInteger(pos) || pos < 0 || pos > FEED_MAX_POSITION) {
    throw new FeedValidationError('invalid shown_position');
  }
  return input;
}

/** Exactly one new row; the video's focus tags are copied from its annotation. */
export async function saveFeedJudgment(db: FeedDb, input: FeedJudgmentInput): Promise<void> {
  const v = validateFeedJudgment(input);
  await db.$executeRawUnsafe(
    `INSERT INTO public.morning_card_judgments (user_id, video_id, domain, cell, focus, verdict, shown_position)
     VALUES ($1::uuid, $2, $3, $3,
             COALESCE((SELECT focus FROM public.morning_feed_annotations WHERE video_id = $2), '{}'::text[]),
             $4, $5)`,
    v.user_id,
    v.video_id,
    v.cell,
    v.verdict,
    v.shown_position
  );
}

/** Undo: marks the user's latest live feed judgment as cancelled. The row stays. */
export async function cancelLastFeedJudgment(db: FeedDb, userId: string): Promise<number> {
  if (!userId) throw new FeedValidationError('user_id required');
  return db.$executeRawUnsafe(
    `UPDATE public.morning_card_judgments SET canceled_at = now()
      WHERE id = (SELECT id FROM public.morning_card_judgments
                   WHERE user_id = $1::uuid AND cell IS NOT NULL AND canceled_at IS NULL
                   ORDER BY created_at DESC LIMIT 1)`,
    userId
  );
}

/** Watch time is capped at one day per video; anything larger is a client error. */
export const MAX_WATCH_SECONDS = 86400;
/** Korea Standard Time offset (UTC+9). */
const KST_OFFSET_HOURS = 9;
const KST_OFFSET_MS = KST_OFFSET_HOURS * MS_PER_HOUR;

export interface FeedWatchInput {
  video_id: string;
  watched_seconds: number;
  last_position: number;
}

function isSecondsInRange(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= MAX_WATCH_SECONDS;
}

/** Upsert: keeps the larger watched_seconds, replaces last_position. */
export async function recordWatch(
  db: FeedDb,
  userId: string,
  input: FeedWatchInput
): Promise<void> {
  if (!userId) throw new FeedValidationError('user_id required');
  if (!YOUTUBE_VIDEO_ID_RE.test(input.video_id ?? '')) {
    throw new FeedValidationError('invalid video_id');
  }
  if (!isSecondsInRange(input.watched_seconds)) {
    throw new FeedValidationError('invalid watched_seconds');
  }
  if (!isSecondsInRange(input.last_position)) {
    throw new FeedValidationError('invalid last_position');
  }
  await db.$executeRawUnsafe(
    `INSERT INTO public.morning_feed_watch (user_id, video_id, watched_seconds, last_position)
     VALUES ($1::uuid, $2, $3, $4)
     ON CONFLICT (user_id, video_id) DO UPDATE SET
       watched_seconds = GREATEST(public.morning_feed_watch.watched_seconds, EXCLUDED.watched_seconds),
       last_position = EXCLUDED.last_position,
       updated_at = now()`,
    userId,
    input.video_id,
    input.watched_seconds,
    input.last_position
  );
}

interface InsightRow {
  video_id: string;
  verdict: string;
  cell: string;
  created_at: Date;
  title: string | null;
  duration_seconds: number | null;
  watched_seconds: number | null;
}

export interface InsightOrderItem {
  video_id: string;
  title: string | null;
  verdict: string;
  cell: string;
  duration_seconds: number | null;
  watched_seconds: number | null;
  at: string;
}

export interface InsightCellStat {
  cell: string;
  count: number;
  watched_seconds: number | null;
}

export interface FeedInsight {
  date_kst: string;
  reacted: number;
  liked: number;
  disliked: number;
  passed: number;
  watched_seconds_total: number | null;
  has_watch_data: boolean;
  by_cell: InsightCellStat[];
  order: InsightOrderItem[];
}

function sumOrNull(values: Array<number | null>): number | null {
  const known = values.filter((v): v is number => v !== null);
  return known.length === 0 ? null : known.reduce((a, b) => a + b, 0);
}

/**
 * Today's summary for the user: the KST calendar day containing `now`, the latest live judgment
 * per video. by_cell and the totals count reacted videos (useful + skip); pass is counted apart.
 * Unknown values are null, never invented.
 */
export async function fetchInsight(
  db: FeedDb,
  userId: string,
  now: Date = new Date()
): Promise<FeedInsight> {
  if (!userId) throw new FeedValidationError('user_id required');
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  const dayStartUtc = new Date(
    Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) - KST_OFFSET_MS
  );
  const dayEndUtc = new Date(dayStartUtc.getTime() + MS_PER_DAY);
  const rows = await db.$queryRawUnsafe<InsightRow[]>(
    `SELECT DISTINCT ON (j.video_id) j.video_id, j.verdict, j.cell, j.created_at,
            v.title, v.duration_seconds, w.watched_seconds
       FROM public.morning_card_judgments j
       LEFT JOIN public.video_pool v ON v.video_id = j.video_id
       LEFT JOIN public.morning_feed_watch w ON w.user_id = j.user_id AND w.video_id = j.video_id
      WHERE j.user_id = $1::uuid AND j.canceled_at IS NULL AND j.cell IS NOT NULL
        AND j.created_at >= $2 AND j.created_at < $3
      ORDER BY j.video_id, j.created_at DESC`,
    userId,
    dayStartUtc,
    dayEndUtc
  );
  const sorted = [...rows].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
  const reacted = sorted.filter((r) => r.verdict !== 'pass');
  const watchOf = (r: InsightRow): number | null =>
    r.watched_seconds == null ? null : Number(r.watched_seconds);
  const cells = new Map<string, InsightRow[]>();
  for (const r of reacted) cells.set(r.cell, [...(cells.get(r.cell) ?? []), r]);
  const byCell: InsightCellStat[] = [...cells.entries()]
    .map(([cell, list]) => ({
      cell,
      count: list.length,
      watched_seconds: sumOrNull(list.map(watchOf)),
    }))
    .sort(
      (a, b) =>
        (b.watched_seconds ?? -1) - (a.watched_seconds ?? -1) ||
        b.count - a.count ||
        a.cell.localeCompare(b.cell)
    );
  const total = sumOrNull(reacted.map(watchOf));
  return {
    date_kst: kst.toISOString().slice(0, 10),
    reacted: reacted.length,
    liked: reacted.filter((r) => r.verdict === 'useful').length,
    disliked: reacted.filter((r) => r.verdict === 'skip').length,
    passed: sorted.length - reacted.length,
    watched_seconds_total: total,
    has_watch_data: total !== null,
    by_cell: byCell,
    order: sorted.map((r) => ({
      video_id: r.video_id,
      title: r.title,
      verdict: r.verdict,
      cell: r.cell,
      duration_seconds: r.duration_seconds,
      watched_seconds: watchOf(r),
      at: new Date(r.created_at).toISOString(),
    })),
  };
}
