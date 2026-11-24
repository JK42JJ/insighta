/**
 * Landing wall (decision 2026-11-24): the signed-out landing page shows original YouTube
 * thumbnails of one day's briefs. This module reads the brief owner's pages of that day and
 * returns video ids plus the public metadata already stored with the page (title, channel).
 * Nothing about a user is returned. Read only; hidden pages (hidden_at set) are skipped, and so
 * are hidden cells (MORNING_HIDDEN_CELLS): `cells` lists only the shown domains, for the landing's
 * domain list.
 */
import { MS_PER_DAY, MS_PER_MINUTE } from '@/utils/time-constants';
import {
  FeedValidationError,
  goalCellLabels,
  kstDayString,
  type FeedDb,
} from '@/modules/morning-feed/feed';
import type { PageVideo } from '@/modules/morning-feed/pages';

/** The lit tiles: the support videos of one brief. */
export const LANDING_WALL_HIGHLIGHT = 6;
/** The other tiles' upper bound. */
export const LANDING_WALL_OTHERS = 14;
/** No page today: the newest day with pages, at most this many days back. */
export const LANDING_WALL_DAYS_BACK = 3;
/** The route keeps one answer this long (in memory). */
export const LANDING_WALL_CACHE_MS = 10 * MS_PER_MINUTE;

export interface LandingWallItem {
  title: string;
  channel: string;
}
export interface LandingWall {
  /** The shown goal cell labels in cell order (the landing's domain list); never a hidden one. */
  cells: string[];
  /** The day the videos come from (YYYY-MM-DD), or null when there is none. */
  date: string | null;
  highlight: string[];
  others: string[];
  items: Record<string, LandingWallItem>;
}

/** No videos (no owner, or no page in the window); the domain list is still sent. */
function emptyWall(cells: string[]): LandingWall {
  return { cells, date: null, highlight: [], others: [], items: {} };
}

interface WallRow {
  cell: string;
  seen_date: string;
  videos?: unknown;
}

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

function pageVideos(raw: unknown): PageVideo[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (v): v is PageVideo =>
      typeof v === 'object' &&
      v !== null &&
      typeof (v as PageVideo).video_id === 'string' &&
      VIDEO_ID_RE.test((v as PageVideo).video_id)
  );
}

/**
 * A brief's evidence videos in brief order: the `support` ones when the page carries roles,
 * else every video (the earlier format has no roles).
 */
function supportVideos(videos: PageVideo[]): PageVideo[] {
  return videos.some((v) => v.role !== undefined)
    ? videos.filter((v) => v.role === 'support')
    : videos;
}

function dayBefore(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) - days * MS_PER_DAY).toISOString().slice(0, 10);
}

/**
 * The wall for the KST day containing `now`, or the newest earlier day with pages (at most
 * LANDING_WALL_DAYS_BACK back). highlight = the support videos of the first brief, in goal cell
 * order, that has at least LANDING_WALL_HIGHLIGHT of them; when none has, it is filled from the
 * day's videos in cell order. others = the other briefs' videos in cell order, then the chosen
 * brief's remaining videos, up to LANDING_WALL_OTHERS. No id appears twice.
 */
export async function readLandingWall(
  db: FeedDb,
  ownerId: string | null,
  now: Date = new Date()
): Promise<LandingWall> {
  const cells = goalCellLabels();
  if (!ownerId) return emptyWall(cells);
  if (!/^[0-9a-f-]{36}$/i.test(ownerId)) throw new FeedValidationError('owner id must be a uuid');
  const today = kstDayString(now);
  const rows = await db.$queryRawUnsafe<WallRow[]>(
    `SELECT p.cell, to_char(p.seen_date, 'YYYY-MM-DD') AS seen_date, p.videos
       FROM public.morning_pages p
      WHERE p.user_id = $1::uuid AND p.seen_date <= $2::date AND p.seen_date >= $3::date
        AND p.cell = ANY($4::text[]) AND p.hidden_at IS NULL
      ORDER BY p.seen_date DESC`,
    ownerId,
    today,
    dayBefore(today, LANDING_WALL_DAYS_BACK),
    cells
  );
  if (rows.length === 0) return emptyWall(cells);
  const date = rows.map((r) => String(r.seen_date)).reduce((a, b) => (b > a ? b : a));
  const byCell = new Map(
    rows.filter((r) => String(r.seen_date) === date).map((r) => [r.cell, pageVideos(r.videos)])
  );
  const order = cells.filter((label) => byCell.has(label));

  const items: Record<string, LandingWallItem> = {};
  const used = new Set<string>();
  const take = (v: PageVideo, into: string[], max: number): void => {
    if (into.length >= max || used.has(v.video_id)) return;
    used.add(v.video_id);
    into.push(v.video_id);
    items[v.video_id] = {
      title: typeof v.title === 'string' ? v.title : '',
      channel: typeof v.channel === 'string' ? v.channel : '',
    };
  };

  const chosen = order.find(
    (label) => supportVideos(byCell.get(label) ?? []).length >= LANDING_WALL_HIGHLIGHT
  );
  const highlight: string[] = [];
  if (chosen) {
    for (const v of supportVideos(byCell.get(chosen) ?? []))
      take(v, highlight, LANDING_WALL_HIGHLIGHT);
  } else {
    for (const label of order)
      for (const v of supportVideos(byCell.get(label) ?? []))
        take(v, highlight, LANDING_WALL_HIGHLIGHT);
  }
  const others: string[] = [];
  for (const label of order) {
    if (label === chosen) continue;
    for (const v of byCell.get(label) ?? []) take(v, others, LANDING_WALL_OTHERS);
  }
  if (chosen) for (const v of byCell.get(chosen) ?? []) take(v, others, LANDING_WALL_OTHERS);
  return { cells, date, highlight, others, items };
}
