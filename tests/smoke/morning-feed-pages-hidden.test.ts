import { saveBriefFeedback } from '@/modules/morning-feed/brief-usage';
import { listPages, readHomePages, readPage, readPageCards } from '@/modules/morning-feed/pages';
import {
  hidePages,
  readHiddenState,
  unhidePages,
  UPSERT_PAGE_SQL,
} from '@/modules/morning-feed/pages-hide';
import { FeedValidationError, type FeedDb } from '@/modules/morning-feed/feed';

export {};

const USER = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-11-24T03:00:00Z');
const CELL = '기술/개발';
const DATE = '2026-11-23';
const VID = 'aaaaaaaaaaa';

/**
 * In-memory stand-in for public.morning_pages: one row, hidden or not. It honours the one thing
 * under test: a morning_pages SELECT only returns the row when its SQL says `hidden_at IS NULL`.
 * UPDATEs of hidden_at flip the row, like the real statements.
 */
function store(initiallyHidden: boolean) {
  const row = { hidden: initiallyHidden };
  const sqls: string[] = [];
  const db: FeedDb = {
    $queryRawUnsafe: jest.fn(async (sql: string) => {
      sqls.push(sql);
      if (sql.includes('morning_card_judgments')) return [] as never;
      if (sql.includes('FROM public.morning_pages')) {
        if (row.hidden && sql.includes('hidden_at IS NULL')) return [] as never;
        return [
          {
            cell: CELL,
            seen_date: DATE,
            headline: 'H',
            core: [{ text: 'c', sources: [{ video_id: VID, t: 0 }] }],
            note: [],
            videos: [{ video_id: VID, title: 'T', channel: 'C', useful_for: '' }],
            one: 1,
          },
        ] as never;
      }
      return [] as never;
    }),
    $executeRawUnsafe: jest.fn(async (sql: string) => {
      sqls.push(sql);
      if (sql.startsWith('UPDATE public.morning_pages SET hidden_at = now()') && !row.hidden) {
        row.hidden = true;
        return 1;
      }
      if (sql.startsWith('UPDATE public.morning_pages SET hidden_at = NULL') && row.hidden) {
        row.hidden = false;
        return 1;
      }
      return 0;
    }),
  };
  return { db, row, sqls };
}

const readAll = async (db: FeedDb) => ({
  page: await readPage(db, USER, CELL, DATE, NOW),
  list: await listPages(db, USER, CELL, NOW),
  home: (await readHomePages(db, USER, NOW)).current,
  cards: await readPageCards(db, USER, CELL, DATE, NOW),
});

describe('hidden pages are not read', () => {
  it('a visible page is returned by every read path', async () => {
    const { db } = store(false);
    const r = await readAll(db);
    expect(r.page?.headline).toBe('H');
    expect(r.list).toHaveLength(1);
    expect(r.home?.headline).toBe('H');
    expect(r.cards?.items).toHaveLength(1);
  });

  it('a hidden page is not returned by page, list, home or cards', async () => {
    const { db } = store(true);
    const r = await readAll(db);
    expect(r.page).toBeNull();
    expect(r.list).toEqual([]);
    expect(r.home).toBeNull();
    expect(r.cards).toBeNull();
  });

  it('every morning_pages SELECT in the readers filters hidden_at IS NULL', async () => {
    const { db, sqls } = store(false);
    await readAll(db);
    await saveBriefFeedback(db, USER, USER, { cell: CELL, date: DATE, value: 'useful' }, NOW);
    const reads = sqls.filter((s) => s.includes('FROM public.morning_pages'));
    expect(reads.length).toBeGreaterThanOrEqual(5);
    for (const s of reads) expect(s).toContain('hidden_at IS NULL');
  });

  it('feedback on a hidden brief is refused and writes nothing', async () => {
    const { db, sqls } = store(true);
    await expect(
      saveBriefFeedback(db, USER, USER, { cell: CELL, date: DATE, value: 'useful' }, NOW)
    ).rejects.toThrow(FeedValidationError);
    expect(sqls.some((s) => s.includes('INSERT INTO public.morning_brief_feedback'))).toBe(false);
  });

  it('hide then unhide: gone, then back', async () => {
    const { db } = store(false);
    expect(await hidePages(db, { cell: CELL, date: DATE }, ' wrong figure ')).toBe(1);
    expect((await readAll(db)).page).toBeNull();
    expect(await hidePages(db, { cell: CELL, date: DATE }, 'again')).toBe(0); // already hidden
    expect(await unhidePages(db, { cell: CELL, date: DATE })).toBe(1);
    expect((await readAll(db)).page?.headline).toBe('H');
    expect(await unhidePages(db, { cell: CELL, date: DATE })).toBe(0);
  });

  it('hide trims the reason, needs one, and validates cell and date', async () => {
    const { db } = store(false);
    await hidePages(db, { cell: CELL, date: DATE, userId: USER }, '  why  ');
    const call = (db.$executeRawUnsafe as jest.Mock).mock.calls[0]!;
    expect(call.slice(1)).toEqual([CELL, DATE, USER, 'why']);
    await expect(hidePages(db, { cell: CELL, date: DATE }, '  ')).rejects.toThrow(/reason/);
    await expect(hidePages(db, { cell: 'x', date: DATE }, 'r')).rejects.toThrow(/cell/);
    await expect(unhidePages(db, { cell: CELL, date: '2026-02-30' })).rejects.toThrow(/date/);
    await expect(readHiddenState(db, { cell: 'x', date: DATE })).rejects.toThrow(/cell/);
  });
});

describe('import of an existing page', () => {
  it('upsert never touches hidden_at / hidden_reason, so a hidden page stays hidden', () => {
    const [, setClause] = UPSERT_PAGE_SQL.split('DO UPDATE SET');
    expect(setClause).toBeDefined();
    expect(setClause).not.toMatch(/hidden/);
    expect(UPSERT_PAGE_SQL.split('ON CONFLICT')[0]).not.toMatch(/hidden/);
    expect(UPSERT_PAGE_SQL).toContain('ON CONFLICT (user_id, cell, seen_date)');
  });
});
