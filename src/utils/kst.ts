/**
 * KST calendar helpers for the weekly curation schedule.
 *
 * The product promise is a KST weekday ("your new edition arrives Monday
 * morning"), but the scheduler used UTC wall-clock arithmetic. The two never
 * lined up, which produced two defects measured on prod 2026-07-27:
 *
 *  - The weekly scan ran once a week (Sun 23:17 UTC) while a subscription became
 *    due at `last_run_at + 7d` — an arbitrary time of day. A due time that landed
 *    anywhere between scans waited for the NEXT one, so the effective period was
 *    8-14 days, not 7. On 2026-07-26 the scan found 0 due rows and built nothing.
 *  - `mondayOf()` resolved the week key in UTC, so at the scan moment (Sunday
 *    23:17 UTC = Monday 08:17 KST) it returned the PREVIOUS Monday. A Monday
 *    morning build would have replaced last week's snapshot instead of opening a
 *    new week.
 *
 * The fix is to stop doing time arithmetic for scheduling and ask the KST
 * calendar instead: a subscription is due when today's KST weekday matches the
 * one the user picked and this KST week has not been built yet.
 */

import { MS_PER_HOUR, MS_PER_DAY } from './time-constants';

/** KST is a fixed offset — no DST, so a constant shift is exact. */
export const KST_OFFSET_HOURS = 9;
const KST_OFFSET_MS = KST_OFFSET_HOURS * MS_PER_HOUR;

/** `d` shifted into KST, so the getUTC* accessors read as KST wall-clock. */
function toKst(d: Date): Date {
  return new Date(d.getTime() + KST_OFFSET_MS);
}

/** KST day of week: 0=Sun .. 6=Sat. */
export function kstDow(d: Date): number {
  return toKst(d).getUTCDay();
}

/** ISO date (YYYY-MM-DD) of the Monday that starts `d`'s KST week. */
export function kstWeekStart(d: Date): string {
  const k = toKst(d);
  const day = k.getUTCDay();
  const backToMonday = (day === 0 ? -6 : 1) - day;
  const mon = new Date(k.getTime() + backToMonday * MS_PER_DAY);
  return mon.toISOString().slice(0, 10);
}

/** Instant (UTC) of 00:00 KST on the Monday that starts `d`'s KST week. */
export function kstWeekStartInstant(d: Date): Date {
  return new Date(new Date(kstWeekStart(d) + 'T00:00:00Z').getTime() - KST_OFFSET_MS);
}

/**
 * ISO date (YYYY-MM-DD) of the Monday of `d`'s week in UTC — the pre-fix key.
 * Kept so the flag-off path reproduces the old behaviour exactly, and so the
 * two copies that used to live in curations.ts and curation-weekly.ts have one
 * home (no-hardcoding rule: one source, not a re-declaration per module).
 */
export function utcWeekStart(d: Date): string {
  const day = d.getUTCDay();
  const backToMonday = (day === 0 ? -6 : 1) - day;
  const mon = new Date(d);
  mon.setUTCDate(d.getUTCDate() + backToMonday);
  return mon.toISOString().slice(0, 10);
}

/**
 * Next occurrence of `weekday` (0=Sun..6=Sat) at `hourKst`:`minuteKst` KST,
 * strictly after `from`. Used to keep `next_run_at` meaningful for display —
 * it is no longer what makes a subscription due.
 */
export function nextKstWeekdayAt(
  weekday: number,
  from: Date,
  hourKst: number,
  minuteKst: number
): Date {
  const k = toKst(from);
  const days = (weekday - k.getUTCDay() + 7) % 7;
  const candidate = new Date(k.getTime() + days * MS_PER_DAY);
  candidate.setUTCHours(hourKst, minuteKst, 0, 0);
  // same weekday but the slot already passed today -> next week
  if (candidate.getTime() <= k.getTime()) {
    candidate.setTime(candidate.getTime() + 7 * MS_PER_DAY);
  }
  return new Date(candidate.getTime() - KST_OFFSET_MS);
}

/** Valid weekday column values (0=Sun..6=Sat). */
export function isValidWeekday(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 6;
}
