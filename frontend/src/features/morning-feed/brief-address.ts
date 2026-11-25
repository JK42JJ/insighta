import { WATCH_RETURN_PATH } from '@/shared/lib/watch-path';

/*
 * A brief's own address (order 2026-11-25 B8): the watch screen's address with the domain and the
 * date. It is what is shared and where a signed-out visitor lands after signing in.
 */

export interface BriefAddress {
  cell: string;
  date: string;
}

const CELL_PARAM = 'cell';
const DATE_PARAM = 'date';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CELL_MAX = 50;

/** The path of a brief ('/morning-cards?view=watch&cell=…&date=…'). */
export function briefPath(b: BriefAddress): string {
  const q = new URLSearchParams({ [CELL_PARAM]: b.cell, [DATE_PARAM]: b.date });
  return WATCH_RETURN_PATH + (WATCH_RETURN_PATH.includes('?') ? '&' : '?') + q.toString();
}

/** The brief an address names, or null. */
export function parseBriefAddress(search: string): BriefAddress | null {
  const q = new URLSearchParams(search);
  const cell = q.get(CELL_PARAM) ?? '';
  const date = q.get(DATE_PARAM) ?? '';
  if (cell === '' || cell.length > CELL_MAX || !DATE_RE.test(date)) return null;
  return { cell, date };
}

/** Where to go after signing in from this address: its brief, else the watch screen. */
export function returnPathOf(search: string): string {
  const b = parseBriefAddress(search);
  return b ? briefPath(b) : WATCH_RETURN_PATH;
}
