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
/** Watch screen: how many videos of the chosen cell are shown per day. Decided here, not by the client. */
export const WATCH_DAILY_VIDEOS = 5;
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

/** One card in the shape GET /morning-feed sends (the watch batch uses the same shape). */
function cardFromRow(r: FeedRow): FeedCard {
  const info = buildInfo(r);
  return {
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
  };
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
): Promise<{
  cells: FeedCellDef[];
  cards: FeedCard[];
  watch_daily: number;
  watch_today: Record<string, number>;
}> {
  const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const earliest = new Date(
    Math.min(
      yearStart.getTime(),
      ...FEED_CELLS.filter((c) => c.windowDays !== null).map((c) => windowStart(c, now).getTime())
    )
  );
  const rowsP = db.$queryRawUnsafe<FeedRow[]>(
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
  const [rows, watchToday] = await Promise.all([rowsP, fetchWatchToday(db, userId, now)]);
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
    for (const r of mine) cards.push(cardFromRow(r));
  }
  return {
    cells: [...FEED_CELLS],
    cards,
    watch_daily: WATCH_DAILY_VIDEOS,
    watch_today: watchToday,
  };
}

interface WatchTodayRow {
  video_id: string;
  cell: string;
}

/**
 * GET /morning-feed `watch_today` (kept for compatibility; the watch screen now reads
 * GET /watch/today instead): per goal cell, how many distinct videos this user judged today
 * (KST calendar day containing `now`, live judgments with a cell, any verdict; a video counts
 * once, under the cell of its latest judgment). Every goal cell is present, 0 when none.
 */
export async function fetchWatchToday(
  db: FeedDb,
  userId: string,
  now: Date = new Date()
): Promise<Record<string, number>> {
  const { start, end } = kstDayBounds(now);
  const rows = await db.$queryRawUnsafe<WatchTodayRow[]>(
    `SELECT DISTINCT ON (j.video_id) j.video_id, j.cell
       FROM public.morning_card_judgments j
      WHERE j.user_id = $1::uuid AND j.canceled_at IS NULL AND j.cell IS NOT NULL
        AND j.created_at >= $2 AND j.created_at < $3
      ORDER BY j.video_id, j.created_at DESC`,
    userId,
    start,
    end
  );
  const counts: Record<string, number> = {};
  for (const c of FEED_CELLS) if (c.dom !== -1) counts[c.label] = 0;
  for (const r of rows) {
    if (isFeedCell(r.cell)) counts[r.cell] = (counts[r.cell] ?? 0) + 1;
  }
  return counts;
}

/** Watch screen "이전 주제": at most this many goals are listed. */
export const FEED_HISTORY_MAX = 5;

export interface FeedHistoryItem {
  /** Goal cell label. */
  cell: string;
  /** KST calendar day, 'YYYY-MM-DD'. */
  day: string;
  /** Videos handed out in that cell's watch batch on that day. */
  count: number;
}

interface HistoryRow {
  cell: string;
  day: string;
  count: number | bigint;
}

/** The 8 goal cells (the centre cell is not a goal). */
function goalCellLabels(): string[] {
  return FEED_CELLS.filter((c) => c.dom !== -1).map((c) => c.label);
}

/**
 * Watch screen "이전 주제" / "어제에 이어서": per goal cell, the most recent KST day before today
 * (the KST day containing `now`) on which the watch screen handed out a batch, and that batch's
 * size. Only morning_watch_batches is read, so the swipe deck's judgments never appear here.
 * Newest day first, then cell label; at most FEED_HISTORY_MAX. Read only.
 */
export async function fetchHistory(
  db: FeedDb,
  userId: string,
  now: Date = new Date()
): Promise<FeedHistoryItem[]> {
  if (!userId) throw new FeedValidationError('user_id required');
  const rows = await db.$queryRawUnsafe<HistoryRow[]>(
    `SELECT x.cell, x.day, x.count FROM (
       SELECT DISTINCT ON (b.cell) b.cell, to_char(b.day, 'YYYY-MM-DD') AS day,
              cardinality(b.video_ids)::int AS count
         FROM public.morning_watch_batches b
        WHERE b.user_id = $1::uuid AND b.cell = ANY($2::text[]) AND b.day < $3::date
        ORDER BY b.cell, b.day DESC
     ) x ORDER BY x.day DESC, x.cell LIMIT $4`,
    userId,
    goalCellLabels(),
    kstDayString(now),
    FEED_HISTORY_MAX
  );
  return rows
    .filter((r) => isFeedCell(r.cell))
    .map((r) => ({ cell: r.cell, day: String(r.day), count: Number(r.count) }))
    .slice(0, FEED_HISTORY_MAX);
}

export interface FeedJudgmentInput {
  user_id: string;
  video_id: string;
  cell: string;
  verdict: string;
  shown_position: number;
  /** Which screen wrote it: absent = the swipe deck (stored NULL), 'watch' = the watch screen. */
  surface?: unknown;
}

/** The only accepted judgment surface (column morning_card_judgments.surface). */
export const WATCH_SURFACE = 'watch';

export interface ValidFeedJudgment {
  user_id: string;
  video_id: string;
  cell: string;
  verdict: string;
  shown_position: number;
  surface: typeof WATCH_SURFACE | null;
}

export function validateFeedJudgment(input: FeedJudgmentInput): ValidFeedJudgment {
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
  if (input.surface !== undefined && input.surface !== WATCH_SURFACE) {
    throw new FeedValidationError('unknown surface');
  }
  return {
    user_id: input.user_id,
    video_id: input.video_id,
    cell: input.cell,
    verdict: input.verdict,
    shown_position: pos,
    surface: input.surface === WATCH_SURFACE ? WATCH_SURFACE : null,
  };
}

/** Exactly one new row; the video's focus tags are copied from its annotation. */
export async function saveFeedJudgment(db: FeedDb, input: FeedJudgmentInput): Promise<void> {
  const v = validateFeedJudgment(input);
  await db.$executeRawUnsafe(
    `INSERT INTO public.morning_card_judgments (user_id, video_id, domain, cell, focus, verdict, shown_position, surface)
     VALUES ($1::uuid, $2, $3, $3,
             COALESCE((SELECT focus FROM public.morning_feed_annotations WHERE video_id = $2), '{}'::text[]),
             $4, $5, $6)`,
    v.user_id,
    v.video_id,
    v.cell,
    v.verdict,
    v.shown_position,
    v.surface
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

/** The KST calendar day containing `now`: the shifted clock and the day's UTC bounds [start, end). */
function kstDayBounds(now: Date): { kst: Date; start: Date; end: Date } {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  const start = new Date(
    Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) - KST_OFFSET_MS
  );
  return { kst, start, end: new Date(start.getTime() + MS_PER_DAY) };
}

/** The KST calendar day containing `now` as 'YYYY-MM-DD' (the batch table's `day`). */
function kstDayString(now: Date): string {
  return kstDayBounds(now).kst.toISOString().slice(0, 10);
}

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
  /** Watch screen insight only: videos handed out in today's batch of the goal. */
  received?: number;
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

export interface FetchInsightOptions {
  /** Only this cell's judgments (watch screen: the chosen goal). Omitted = all cells. */
  cell?: string;
}

/**
 * Today's summary for the user: the KST calendar day containing `now`, the latest live judgment
 * per video. by_cell and the totals count reacted videos (useful + skip); pass is counted apart.
 * With `opts.cell` only that cell's judgments are read. Unknown values are null, never invented.
 */
export async function fetchInsight(
  db: FeedDb,
  userId: string,
  now: Date = new Date(),
  opts: FetchInsightOptions = {}
): Promise<FeedInsight> {
  if (!userId) throw new FeedValidationError('user_id required');
  if (opts.cell !== undefined && !isFeedCell(opts.cell)) {
    throw new FeedValidationError('unknown cell');
  }
  const { kst, start: dayStartUtc, end: dayEndUtc } = kstDayBounds(now);
  const params: unknown[] = [userId, dayStartUtc, dayEndUtc];
  let cellFilter = '';
  if (opts.cell !== undefined) {
    params.push(opts.cell);
    cellFilter = ` AND j.cell = $${params.length}`;
  }
  const rows = await db.$queryRawUnsafe<InsightRow[]>(
    `SELECT DISTINCT ON (j.video_id) j.video_id, j.verdict, j.cell, j.created_at,
            v.title, v.duration_seconds, w.watched_seconds
       FROM public.morning_card_judgments j
       LEFT JOIN public.video_pool v ON v.video_id = j.video_id
       LEFT JOIN public.morning_feed_watch w ON w.user_id = j.user_id AND w.video_id = j.video_id
      WHERE j.user_id = $1::uuid AND j.canceled_at IS NULL AND j.cell IS NOT NULL
        AND j.created_at >= $2 AND j.created_at < $3${cellFilter}
      ORDER BY j.video_id, j.created_at DESC`,
    ...params
  );
  return summariseInsight(rows, kst);
}

/**
 * Totals, per-cell stats and the answer order from the latest live judgment per video.
 * Passed videos are counted apart and never add to reacted or watched time.
 */
function summariseInsight(rows: InsightRow[], kst: Date): FeedInsight {
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

// ── Watch screen daily batch (morning_watch_batches) ──

/** Watch screen candidates: only annotations from this gate-passed review pass. */
export const WATCH_CANDIDATE_SOURCE = 'review_v3';

export type FeedVerdict = (typeof FEED_VERDICTS)[number];

export interface WatchBatch {
  cell: string;
  /** KST calendar day, 'YYYY-MM-DD'. */
  day: string;
  /** Batch order; the index is the judgment's shown_position. */
  items: FeedCard[];
  /** Latest live watch-screen verdict per batch video; videos not answered yet are absent. */
  judged: Record<string, FeedVerdict>;
}

export interface WatchTodayCell {
  /** Videos in today's batch; null = no batch yet today. */
  issued: number | null;
  /** Distinct batch videos with a live watch-screen judgment. */
  judged: number;
  /** Videos a new batch would get (0..WATCH_DAILY_VIDEOS); 0 once today's batch exists. */
  available: number;
}

export interface WatchToday {
  day: string;
  daily: number;
  cells: FeedCellDef[];
  /** One entry per goal cell (8). */
  today: Record<string, WatchTodayCell>;
}

interface BatchIdsRow {
  video_ids: string[];
}

interface CandidateRow {
  video_id: string;
}

interface JudgedRow {
  video_id: string;
  verdict: string;
}

interface TodayBatchRow {
  cell: string;
  issued: number | bigint;
  judged: number | bigint;
}

interface AvailableRow {
  cell: string;
  available: number | bigint;
}

/**
 * Candidate filter shared by batch creation and the per-cell "available" count. Parameters:
 * $1 user, $2 duration floor, $3 source. Excludes videos with any live judgment by the user
 * (any surface) and videos in any of the user's batches.
 */
const WATCH_CANDIDATE_WHERE = `
       FROM public.morning_feed_annotations a
       JOIN public.video_pool v ON v.video_id = a.video_id
      WHERE a.source = $3 AND a.why IS NOT NULL
        AND v.is_active = true AND v.duration_seconds >= $2
        AND NOT EXISTS (
          SELECT 1 FROM public.morning_card_judgments j
           WHERE j.user_id = $1::uuid AND j.video_id = a.video_id AND j.canceled_at IS NULL)
        AND NOT EXISTS (
          SELECT 1 FROM public.morning_watch_batches b
           WHERE b.user_id = $1::uuid AND a.video_id = ANY(b.video_ids))`;

function assertGoalCell(userId: string, cell: unknown): asserts cell is string {
  if (!userId) throw new FeedValidationError('user_id required');
  if (!isFeedCell(cell)) throw new FeedValidationError('unknown cell');
}

async function selectBatchIds(
  db: FeedDb,
  userId: string,
  day: string,
  cell: string
): Promise<string[] | null> {
  const rows = await db.$queryRawUnsafe<BatchIdsRow[]>(
    `SELECT b.video_ids FROM public.morning_watch_batches b
      WHERE b.user_id = $1::uuid AND b.day = $2::date AND b.cell = $3`,
    userId,
    day,
    cell
  );
  return rows[0] ? [...rows[0].video_ids] : null;
}

/** The batch videos as feed cards, in batch order. */
async function selectBatchCards(db: FeedDb, ids: string[], cell: string): Promise<FeedCard[]> {
  if (ids.length === 0) return [];
  const rows = await db.$queryRawUnsafe<FeedRow[]>(
    `SELECT COALESCE(a.cell, $2) AS cell, a.focus, COALESCE(a.why, '') AS why, a.judge_score,
            v.video_id, v.title, v.channel_name, v.published_at, v.duration_seconds,
            v.thumbnail_url, v.view_count,
            COALESCE(NULLIF(i.one_liner, ''), NULLIF(r.one_liner, '')) AS info_one_liner,
            i.reason AS info_reason, i.audio_language AS info_audio_language,
            i.link_count AS info_link_count, i.chapters AS info_chapters
       FROM unnest($1::text[]) WITH ORDINALITY AS u(video_id, ord)
       JOIN public.video_pool v ON v.video_id = u.video_id
       LEFT JOIN public.morning_feed_annotations a ON a.video_id = u.video_id
       LEFT JOIN public.morning_feed_card_info i ON i.video_id = u.video_id AND i.expires_at > now()
       LEFT JOIN public.video_rich_summaries r ON r.video_id = u.video_id
      ORDER BY u.ord`,
    ids,
    cell
  );
  return rows.map(cardFromRow);
}

/** Latest live watch-screen verdict per video, for this user and these videos. */
async function selectWatchVerdicts(
  db: FeedDb,
  userId: string,
  ids: string[]
): Promise<Record<string, FeedVerdict>> {
  const out: Record<string, FeedVerdict> = {};
  if (ids.length === 0) return out;
  const rows = await db.$queryRawUnsafe<JudgedRow[]>(
    `SELECT DISTINCT ON (j.video_id) j.video_id, j.verdict
       FROM public.morning_card_judgments j
      WHERE j.user_id = $1::uuid AND j.canceled_at IS NULL AND j.surface = $2
        AND j.video_id = ANY($3::text[])
      ORDER BY j.video_id, j.created_at DESC`,
    userId,
    WATCH_SURFACE,
    ids
  );
  for (const r of rows) {
    if ((FEED_VERDICTS as readonly string[]).includes(r.verdict)) {
      out[r.video_id] = r.verdict as FeedVerdict;
    }
  }
  return out;
}

/**
 * POST /morning-feed/watch/batch: today's batch (KST day) for one goal cell. An existing batch is
 * returned as stored. Otherwise up to WATCH_DAILY_VIDEOS candidates (judge score desc, nulls last,
 * then video_id) are stored with ON CONFLICT DO NOTHING and the stored row is read back, so two
 * concurrent requests answer the same batch. No candidates -> items [] and nothing is stored.
 */
export async function getOrCreateWatchBatch(
  db: FeedDb,
  userId: string,
  cell: unknown,
  now: Date = new Date()
): Promise<WatchBatch> {
  assertGoalCell(userId, cell);
  const day = kstDayString(now);
  let ids = await selectBatchIds(db, userId, day, cell);
  if (ids === null) {
    const candidates = await db.$queryRawUnsafe<CandidateRow[]>(
      `SELECT a.video_id${WATCH_CANDIDATE_WHERE}
        AND a.cell = $4
      ORDER BY a.judge_score DESC NULLS LAST, a.video_id
      LIMIT $5`,
      userId,
      FEED_MIN_DURATION_SEC,
      WATCH_CANDIDATE_SOURCE,
      cell,
      WATCH_DAILY_VIDEOS
    );
    const picked = candidates.map((c) => c.video_id);
    if (picked.length === 0) return { cell, day, items: [], judged: {} };
    await db.$executeRawUnsafe(
      `INSERT INTO public.morning_watch_batches (user_id, day, cell, video_ids)
       VALUES ($1::uuid, $2::date, $3, $4::text[])
       ON CONFLICT (user_id, day, cell) DO NOTHING`,
      userId,
      day,
      cell,
      picked
    );
    // the stored row wins (a concurrent request may have inserted first)
    ids = (await selectBatchIds(db, userId, day, cell)) ?? picked;
  }
  const [items, judged] = await Promise.all([
    selectBatchCards(db, ids, cell),
    selectWatchVerdicts(db, userId, ids),
  ]);
  return { cell, day, items, judged };
}

/**
 * GET /morning-feed/watch/today: per goal cell, today's batch size and how many of its videos were
 * answered on the watch screen, or (no batch yet) how many videos a new batch would get.
 */
export async function fetchWatchTodayBatches(
  db: FeedDb,
  userId: string,
  now: Date = new Date()
): Promise<WatchToday> {
  if (!userId) throw new FeedValidationError('user_id required');
  const day = kstDayString(now);
  const cells = goalCellLabels();
  const batchesP = db.$queryRawUnsafe<TodayBatchRow[]>(
    `SELECT b.cell, cardinality(b.video_ids)::int AS issued,
            (SELECT COUNT(DISTINCT j.video_id)::int FROM public.morning_card_judgments j
              WHERE j.user_id = b.user_id AND j.canceled_at IS NULL AND j.surface = $3
                AND j.video_id = ANY(b.video_ids)) AS judged
       FROM public.morning_watch_batches b
      WHERE b.user_id = $1::uuid AND b.day = $2::date`,
    userId,
    day,
    WATCH_SURFACE
  );
  const availableP = db.$queryRawUnsafe<AvailableRow[]>(
    `SELECT a.cell, COUNT(*)::int AS available${WATCH_CANDIDATE_WHERE}
        AND a.cell = ANY($4::text[])
      GROUP BY a.cell`,
    userId,
    FEED_MIN_DURATION_SEC,
    WATCH_CANDIDATE_SOURCE,
    cells
  );
  const [batches, available] = await Promise.all([batchesP, availableP]);
  const today: Record<string, WatchTodayCell> = {};
  for (const c of cells) today[c] = { issued: null, judged: 0, available: 0 };
  for (const a of available) {
    const entry = today[a.cell];
    if (entry) entry.available = Math.min(WATCH_DAILY_VIDEOS, Number(a.available));
  }
  for (const b of batches) {
    const entry = today[b.cell];
    if (entry) {
      entry.issued = Number(b.issued);
      entry.judged = Number(b.judged);
      entry.available = 0;
    }
  }
  return { day, daily: WATCH_DAILY_VIDEOS, cells: [...FEED_CELLS], today };
}

/**
 * GET /morning-feed/watch/insight?cell=: the insight of today's batch of one goal. received = batch
 * size; verdicts from live watch-screen judgments on the batch videos (swipe-deck judgments are
 * not read); watched time from morning_feed_watch for those videos. No batch -> all zero.
 */
export async function fetchWatchInsight(
  db: FeedDb,
  userId: string,
  cell: unknown,
  now: Date = new Date()
): Promise<FeedInsight> {
  assertGoalCell(userId, cell);
  const { kst } = kstDayBounds(now);
  const day = kstDayString(now);
  const ids = await selectBatchIds(db, userId, day, cell);
  if (ids === null || ids.length === 0) return { ...summariseInsight([], kst), received: 0 };
  const rows = await db.$queryRawUnsafe<InsightRow[]>(
    `SELECT DISTINCT ON (j.video_id) j.video_id, j.verdict, j.cell, j.created_at,
            v.title, v.duration_seconds, w.watched_seconds
       FROM public.morning_card_judgments j
       LEFT JOIN public.video_pool v ON v.video_id = j.video_id
       LEFT JOIN public.morning_feed_watch w ON w.user_id = j.user_id AND w.video_id = j.video_id
      WHERE j.user_id = $1::uuid AND j.canceled_at IS NULL AND j.surface = $2
        AND j.video_id = ANY($3::text[])
      ORDER BY j.video_id, j.created_at DESC`,
    userId,
    WATCH_SURFACE,
    ids
  );
  return { ...summariseInsight(rows, kst), received: ids.length };
}
