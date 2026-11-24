/**
 * Withdrawing a brief = hide it, never delete it (decision R40 option a, 2026-11-24). A hidden
 * page keeps its row; hidden_at / hidden_reason (prisma/migrations/morning-feed/009_pages_hidden.sql)
 * make every reader in pages.ts and brief-usage.ts skip it. These helpers are the only writers of
 * those two columns; scripts/morning-pages/{hide,unhide,import}-page.ts call them.
 */
import { FeedValidationError, isFeedCell, type FeedDb } from '@/modules/morning-feed/feed';
import { isRealDate } from '@/modules/morning-feed/pages';

export interface PageKey {
  cell: string;
  date: string;
  /** Narrow to one owner; unset = every owner's row of that (cell, date). */
  userId?: string;
}
export interface HiddenState {
  user_id: string;
  cell: string;
  seen_date: string;
  headline: string;
  hidden_at: string | null;
  hidden_reason: string | null;
}

/**
 * Re-import of a page: INSERT ... ON CONFLICT DO UPDATE. hidden_at / hidden_reason are deliberately
 * absent from the SET list, so re-importing a hidden page leaves it hidden.
 * Params: user_id, cell, seen_date, headline, core, note, videos.
 */
export const UPSERT_PAGE_SQL = `INSERT INTO public.morning_pages (user_id, cell, seen_date, headline, core, note, videos, origin)
       VALUES ($1::uuid, $2, $3::date, $4, $5::jsonb, $6::jsonb, $7::jsonb, 'import')
       ON CONFLICT (user_id, cell, seen_date) DO UPDATE SET
         headline = EXCLUDED.headline, core = EXCLUDED.core, note = EXCLUDED.note,
         videos = EXCLUDED.videos, origin = 'import', updated_at = now()`;

const STATE_COLUMNS = `user_id::text AS user_id, cell, to_char(seen_date, 'YYYY-MM-DD') AS seen_date,
       headline, to_char(hidden_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS hidden_at, hidden_reason`;

function checkKey(key: PageKey): void {
  if (!isFeedCell(key.cell)) throw new FeedValidationError('unknown cell');
  if (!isRealDate(key.date)) throw new FeedValidationError('invalid date');
}

/** The matching rows with their hidden state (visible or not). */
export async function readHiddenState(db: FeedDb, key: PageKey): Promise<HiddenState[]> {
  checkKey(key);
  return db.$queryRawUnsafe<HiddenState[]>(
    `SELECT ${STATE_COLUMNS} FROM public.morning_pages
      WHERE cell = $1 AND seen_date = $2::date AND ($3::uuid IS NULL OR user_id = $3::uuid)
      ORDER BY user_id`,
    key.cell,
    key.date,
    key.userId ?? null
  );
}

/** Hide the matching pages (keeps the first hidden_at of an already hidden one). Returns rows changed. */
export async function hidePages(db: FeedDb, key: PageKey, reason: string): Promise<number> {
  checkKey(key);
  if (typeof reason !== 'string' || reason.trim() === '') {
    throw new FeedValidationError('reason must be a non-empty string');
  }
  return db.$executeRawUnsafe(
    `UPDATE public.morning_pages SET hidden_at = now(), hidden_reason = $4, updated_at = now()
      WHERE cell = $1 AND seen_date = $2::date AND ($3::uuid IS NULL OR user_id = $3::uuid)
        AND hidden_at IS NULL`,
    key.cell,
    key.date,
    key.userId ?? null,
    reason.trim()
  );
}

/** Make the matching hidden pages visible again. Returns rows changed. */
export async function unhidePages(db: FeedDb, key: PageKey): Promise<number> {
  checkKey(key);
  return db.$executeRawUnsafe(
    `UPDATE public.morning_pages SET hidden_at = NULL, hidden_reason = NULL, updated_at = now()
      WHERE cell = $1 AND seen_date = $2::date AND ($3::uuid IS NULL OR user_id = $3::uuid)
        AND hidden_at IS NOT NULL`,
    key.cell,
    key.date,
    key.userId ?? null
  );
}
