/**
 * Morning feed pages: one read-only page per (user, goal cell, seen date), shown on the watch home.
 * Pages are imported by scripts/morning-pages/import-page.ts; this module validates the page JSON
 * and reads rows. It never writes.
 */
import {
  FEED_CELLS,
  FeedValidationError,
  goalCellLabels,
  isFeedCell,
  kstDayString,
  type FeedDb,
} from '@/modules/morning-feed/feed';

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** listPages upper bound. */
export const PAGES_LIST_MAX = 60;

export interface PageSource {
  video_id: string;
  /** Seconds into the video. */
  t: number;
}
export interface PageCoreItem {
  text: string;
  sources: PageSource[];
}
export interface PageNoteSection {
  heading: string;
  paragraphs: PageCoreItem[];
}
export interface PageVideo {
  video_id: string;
  title: string;
  channel: string;
  useful_for: string;
}
export interface Page {
  domain: string;
  seen_date: string;
  headline: string;
  core: PageCoreItem[];
  note: PageNoteSection[];
  videos: PageVideo[];
}
export interface PageSummary {
  domain: string;
  seen_date: string;
  headline: string;
}
export interface HomePages {
  current: Page | null;
  lastDomain: string | null;
  others: PageSummary[];
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function reqString(v: unknown, what: string): string {
  if (typeof v !== 'string' || v.trim() === '') {
    throw new FeedValidationError(`${what} must be a non-empty string`);
  }
  return v;
}

/** True when `s` is YYYY-MM-DD and names a real calendar date. */
export function isRealDate(s: unknown): s is string {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function validateSources(v: unknown, where: string, videoIds: Set<string>): PageSource[] {
  if (!Array.isArray(v)) throw new FeedValidationError(`${where}.sources must be an array`);
  return v.map((s, i) => {
    const w = `${where}.sources[${i}]`;
    if (!isObj(s)) throw new FeedValidationError(`${w} must be an object`);
    const id = s['video_id'];
    if (typeof id !== 'string' || !VIDEO_ID_RE.test(id)) {
      throw new FeedValidationError(`${w}.video_id must be an 11-character YouTube id`);
    }
    const t = s['t'];
    if (typeof t !== 'number' || !Number.isInteger(t) || t < 0) {
      throw new FeedValidationError(`${w}.t must be an integer >= 0 (seconds)`);
    }
    if (!videoIds.has(id)) {
      throw new FeedValidationError(`${w}.video_id ${id} is not listed in videos`);
    }
    return { video_id: id, t };
  });
}

function validateText(v: unknown, where: string, videoIds: Set<string>): PageCoreItem {
  if (!isObj(v)) throw new FeedValidationError(`${where} must be an object`);
  return {
    text: reqString(v['text'], `${where}.text`),
    sources: validateSources(v['sources'], where, videoIds),
  };
}

/**
 * Validates page JSON (import file and API output share this shape).
 * @throws FeedValidationError with the failing path in the message.
 */
export function validatePage(input: unknown): Page {
  if (!isObj(input)) throw new FeedValidationError('page must be an object');
  const domain = input['domain'];
  if (!isFeedCell(domain)) throw new FeedValidationError('domain must be a goal cell label');
  const seen = input['seen_date'];
  if (!isRealDate(seen)) throw new FeedValidationError('seen_date must be a real YYYY-MM-DD date');
  const headline = reqString(input['headline'], 'headline');

  const rawVideos = input['videos'];
  if (!Array.isArray(rawVideos)) throw new FeedValidationError('videos must be an array');
  const videos: PageVideo[] = rawVideos.map((v, i) => {
    const w = `videos[${i}]`;
    if (!isObj(v)) throw new FeedValidationError(`${w} must be an object`);
    const id = v['video_id'];
    if (typeof id !== 'string' || !VIDEO_ID_RE.test(id)) {
      throw new FeedValidationError(`${w}.video_id must be an 11-character YouTube id`);
    }
    if (typeof v['title'] !== 'string')
      throw new FeedValidationError(`${w}.title must be a string`);
    if (typeof v['channel'] !== 'string') {
      throw new FeedValidationError(`${w}.channel must be a string`);
    }
    if (typeof v['useful_for'] !== 'string') {
      throw new FeedValidationError(`${w}.useful_for must be a string`);
    }
    return { video_id: id, title: v['title'], channel: v['channel'], useful_for: v['useful_for'] };
  });
  const videoIds = new Set(videos.map((v) => v.video_id));

  const rawCore = input['core'];
  if (!Array.isArray(rawCore) || rawCore.length === 0) {
    throw new FeedValidationError('core must be a non-empty array');
  }
  const core = rawCore.map((c, i) => validateText(c, `core[${i}]`, videoIds));

  const rawNote = input['note'];
  if (!Array.isArray(rawNote)) throw new FeedValidationError('note must be an array');
  const note: PageNoteSection[] = rawNote.map((n, i) => {
    const w = `note[${i}]`;
    if (!isObj(n)) throw new FeedValidationError(`${w} must be an object`);
    const heading = reqString(n['heading'], `${w}.heading`);
    const ps = n['paragraphs'];
    if (!Array.isArray(ps)) throw new FeedValidationError(`${w}.paragraphs must be an array`);
    return {
      heading,
      paragraphs: ps.map((p, j) => validateText(p, `${w}.paragraphs[${j}]`, videoIds)),
    };
  });

  return { domain, seen_date: seen, headline, core, note, videos };
}

interface PageRow {
  cell: string;
  seen_date: string;
  headline: string;
  core?: unknown;
  note?: unknown;
  videos?: unknown;
}

function rowToPage(r: PageRow): Page {
  return {
    domain: r.cell,
    seen_date: String(r.seen_date),
    headline: r.headline,
    core: (r.core ?? []) as PageCoreItem[],
    note: (r.note ?? []) as PageNoteSection[],
    videos: (r.videos ?? []) as PageVideo[],
  };
}

const PAGE_COLUMNS = `p.cell, to_char(p.seen_date, 'YYYY-MM-DD') AS seen_date, p.headline, p.core, p.note, p.videos`;

/**
 * Watch home: the page of the user's most recent watch domain, plus the newest page of every
 * other domain (headline and date only, goal cell order). "Today" is the KST day containing `now`.
 */
export async function readHomePages(
  db: FeedDb,
  userId: string,
  now: Date = new Date()
): Promise<HomePages> {
  if (!userId) throw new FeedValidationError('user_id required');
  const today = kstDayString(now);
  const last = await db.$queryRawUnsafe<Array<{ cell: string }>>(
    `SELECT b.cell FROM public.morning_watch_batches b
      WHERE b.user_id = $1::uuid AND b.day <= $2::date AND b.cell = ANY($3::text[])
      ORDER BY b.day DESC, b.created_at DESC LIMIT 1`,
    userId,
    today,
    goalCellLabels()
  );
  const lastDomain = last[0] && isFeedCell(last[0].cell) ? last[0].cell : null;

  const newest = await db.$queryRawUnsafe<PageRow[]>(
    `SELECT DISTINCT ON (p.cell) ${PAGE_COLUMNS}
       FROM public.morning_pages p
      WHERE p.user_id = $1::uuid AND p.seen_date <= $2::date AND p.cell = ANY($3::text[])
      ORDER BY p.cell, p.seen_date DESC`,
    userId,
    today,
    goalCellLabels()
  );
  const byCell = new Map(newest.map((r) => [r.cell, r]));
  const currentRow = lastDomain ? byCell.get(lastDomain) : undefined;
  const others: PageSummary[] = [];
  for (const c of FEED_CELLS) {
    if (c.dom === -1 || c.label === lastDomain) continue;
    const r = byCell.get(c.label);
    if (r) others.push({ domain: r.cell, seen_date: String(r.seen_date), headline: r.headline });
  }
  return { current: currentRow ? rowToPage(currentRow) : null, lastDomain, others };
}

/** One page by key, or null. */
export async function readPage(
  db: FeedDb,
  userId: string,
  cell: string,
  date: string
): Promise<Page | null> {
  if (!userId) throw new FeedValidationError('user_id required');
  if (!isFeedCell(cell)) throw new FeedValidationError('unknown cell');
  if (!isRealDate(date)) throw new FeedValidationError('invalid date');
  const rows = await db.$queryRawUnsafe<PageRow[]>(
    `SELECT ${PAGE_COLUMNS} FROM public.morning_pages p
      WHERE p.user_id = $1::uuid AND p.cell = $2 AND p.seen_date = $3::date`,
    userId,
    cell,
    date
  );
  return rows[0] ? rowToPage(rows[0]) : null;
}

/** Pages of one domain, newest first, at most PAGES_LIST_MAX. */
export async function listPages(
  db: FeedDb,
  userId: string,
  cell: string
): Promise<Array<{ seen_date: string; headline: string }>> {
  if (!userId) throw new FeedValidationError('user_id required');
  if (!isFeedCell(cell)) throw new FeedValidationError('unknown cell');
  const rows = await db.$queryRawUnsafe<PageRow[]>(
    `SELECT to_char(p.seen_date, 'YYYY-MM-DD') AS seen_date, p.headline
       FROM public.morning_pages p
      WHERE p.user_id = $1::uuid AND p.cell = $2
      ORDER BY p.seen_date DESC LIMIT $3`,
    userId,
    cell,
    PAGES_LIST_MAX
  );
  return rows.map((r) => ({ seen_date: String(r.seen_date), headline: r.headline }));
}
