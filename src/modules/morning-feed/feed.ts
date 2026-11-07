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
const MS_PER_DAY = 86_400_000;
export const FEED_VERDICTS = ['useful', 'skip'] as const;

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
            v.duration_seconds, v.thumbnail_url, v.view_count
       FROM public.morning_feed_annotations a
       JOIN public.video_pool v ON v.video_id = a.video_id
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
