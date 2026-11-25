import { fetchMorningPage, type MorningPage } from '@/features/morning-cards/api';

/*
 * Briefs kept in memory for the visit (decision 2026-11-25): the home's briefs are read when the
 * home is entered, and a brief that was read once is never read again. Reading records nothing on
 * the server (GET /pages only selects); brief_open is sent by the opened screen, not from here.
 */

export interface BriefCache {
  /** The brief as far as it is known now (no request). */
  peek: (cell: string, date: string) => MorningPage | undefined;
  /** The kept brief, the read already under way, or a new read. null = not found (not kept). */
  load: (cell: string, date: string) => Promise<MorningPage | null>;
  /** A brief that came with the home (without this viewer's reaction): shown at once, read once. */
  seed: (page: MorningPage) => void;
  /** This viewer's reaction, kept with the brief. */
  setFeedback: (cell: string, date: string, value: MorningPage['feedback']) => void;
}

const keyOf = (cell: string, date: string): string => cell + '|' + date;

export function createBriefCache(
  read: (cell: string, date: string) => Promise<MorningPage | null> = fetchMorningPage
): BriefCache {
  const pages = new Map<string, MorningPage>();
  /** Read in full (with the reaction): never read again. */
  const complete = new Set<string>();
  const pending = new Map<string, Promise<MorningPage | null>>();
  /** A reaction given before its brief's read came back wins over the read. */
  const given = new Map<string, MorningPage['feedback']>();

  const keep = (key: string, page: MorningPage): MorningPage => {
    const out = given.has(key) ? { ...page, feedback: given.get(key) ?? null } : page;
    pages.set(key, out);
    return out;
  };

  return {
    peek: (cell, date) => pages.get(keyOf(cell, date)),
    load: (cell, date) => {
      const key = keyOf(cell, date);
      const kept = pages.get(key);
      if (kept && complete.has(key)) return Promise.resolve(kept);
      const under = pending.get(key);
      if (under) return under;
      const p = read(cell, date)
        .then((page) => {
          if (!page) return null;
          complete.add(key);
          return keep(key, page);
        })
        .finally(() => pending.delete(key));
      pending.set(key, p);
      return p;
    },
    seed: (page) => {
      const key = keyOf(page.domain, page.seen_date);
      if (!pages.has(key)) keep(key, page);
    },
    setFeedback: (cell, date, value) => {
      const key = keyOf(cell, date);
      given.set(key, value);
      const page = pages.get(key);
      if (page) keep(key, page);
    },
  };
}
