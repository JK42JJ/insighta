import { isVirtualDayUser } from '@/config/morning-cards';
import { FeedValidationError, kstDayString, type FeedDb } from '@/modules/morning-feed/feed';
import { MS_PER_DAY } from '@/utils/time-constants';

/*
 * Virtual "today" for repeat tests on stg (decision 2026-11-14). An allowed account can move its
 * own today forward a day at a time or back to the real day. Every watch read decides "today" from
 * the `now` it is given; the routes pass effectiveNow() instead of the clock, so batches, chip state,
 * pages, the home, the past list and the done check all follow the virtual day. Judgments are
 * written with the database clock as before (the write path is untouched). Without a row, or for
 * any other account, effectiveNow() returns `now` unchanged.
 */

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The stored virtual day ('YYYY-MM-DD') of an allowed account, else null. */
export async function readVirtualDay(db: FeedDb, userId: string): Promise<string | null> {
  if (!isVirtualDayUser(userId)) return null;
  const rows = await db.$queryRawUnsafe<Array<{ day: string }>>(
    `SELECT to_char(day, 'YYYY-MM-DD') AS day FROM public.morning_virtual_day WHERE user_id = $1::uuid`,
    userId
  );
  return rows[0]?.day ?? null;
}

/**
 * `now` moved to the virtual day at the same KST time of day, so kstDayString() of the result is
 * the virtual day; `now` itself when there is no virtual day.
 */
export function shiftToDay(now: Date, day: string): Date {
  const m = DAY_RE.exec(day);
  if (!m) return now;
  const realDay = kstDayString(now);
  const r = DAY_RE.exec(realDay)!;
  const diffDays = Math.round(
    (Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) -
      Date.UTC(Number(r[1]), Number(r[2]) - 1, Number(r[3]))) /
      MS_PER_DAY
  );
  return new Date(now.getTime() + diffDays * MS_PER_DAY);
}

/** The `now` every watch read should use for this account. */
export async function effectiveNow(
  db: FeedDb,
  userId: string,
  now: Date = new Date()
): Promise<Date> {
  const day = await readVirtualDay(db, userId);
  return day ? shiftToDay(now, day) : now;
}

/** The day after `day` ('YYYY-MM-DD'). */
export function nextDay(day: string): string {
  const m = DAY_RE.exec(day);
  if (!m) throw new FeedValidationError('invalid day');
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + MS_PER_DAY)
    .toISOString()
    .slice(0, 10);
}

export interface TestClock {
  /** The account may use the virtual day (stg + allow-list). */
  enabled: boolean;
  /** The virtual day, or null when the real day is used. */
  day: string | null;
  /** The real KST day. */
  real: string;
}

export async function readTestClock(
  db: FeedDb,
  userId: string,
  now: Date = new Date()
): Promise<TestClock> {
  const enabled = isVirtualDayUser(userId);
  return {
    enabled,
    day: enabled ? await readVirtualDay(db, userId) : null,
    real: kstDayString(now),
  };
}

/** 'next' moves the account's today one day on from what it is now; 'reset' goes back to real. */
export async function moveTestClock(
  db: FeedDb,
  userId: string,
  action: 'next' | 'reset',
  now: Date = new Date()
): Promise<TestClock> {
  if (!isVirtualDayUser(userId)) throw new FeedValidationError('virtual day not allowed');
  if (action === 'reset') {
    await db.$executeRawUnsafe(
      `DELETE FROM public.morning_virtual_day WHERE user_id = $1::uuid`,
      userId
    );
  } else {
    const from = (await readVirtualDay(db, userId)) ?? kstDayString(now);
    await db.$executeRawUnsafe(
      `INSERT INTO public.morning_virtual_day (user_id, day) VALUES ($1::uuid, $2::date)
       ON CONFLICT (user_id) DO UPDATE SET day = EXCLUDED.day, updated_at = now()`,
      userId,
      nextDay(from)
    );
  }
  return readTestClock(db, userId, now);
}
