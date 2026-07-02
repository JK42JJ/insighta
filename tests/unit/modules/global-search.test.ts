/**
 * Global search (⌘K) Phase 1 — pure helper unit tests.
 * DB-hitting group queries are covered by the prod verification step
 * (design doc §4); these tests pin the injectable/pure surface.
 */
import {
  escapeLikePattern,
  extractTiptapText,
  makeSnippet,
  mergeCardHits,
  withGroupTimeout,
  globalSearch,
  type CardHit,
} from '../../../src/modules/search/global-search';

const cardHit = (over: Partial<CardHit>): CardHit => ({
  kind: 'video',
  id: 'id',
  title: null,
  channelTitle: null,
  thumbnailUrl: null,
  url: null,
  videoId: null,
  note: null,
  mandalaId: null,
  cellIndex: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

describe('escapeLikePattern', () => {
  it('escapes %, _ and backslash so user input matches literally', () => {
    expect(escapeLikePattern('100%_done\\x')).toBe('100\\%\\_done\\\\x');
  });

  it('leaves plain korean/english text untouched', () => {
    expect(escapeLikePattern('수동태 grammar')).toBe('수동태 grammar');
  });
});

describe('extractTiptapText', () => {
  it('walks nested TipTap doc collecting text nodes in order', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'heading', content: [{ type: 'text', text: '수동태 정리' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'be동사 +' },
            { type: 'text', text: '과거분사' },
          ],
        },
      ],
    };
    expect(extractTiptapText(doc)).toContain('수동태 정리');
    expect(extractTiptapText(doc)).toContain('과거분사');
  });

  it('returns empty string for null/primitive input', () => {
    expect(extractTiptapText(null)).toBe('');
    expect(extractTiptapText('raw')).toBe('');
  });
});

describe('makeSnippet', () => {
  it('centers the snippet on the first case-insensitive hit with ellipses', () => {
    const text = `${'a'.repeat(200)} 수동태 핵심 정리 ${'b'.repeat(200)}`;
    const snip = makeSnippet(text, '수동태', 20);
    expect(snip).toContain('수동태');
    expect(snip.startsWith('…')).toBe(true);
    expect(snip.endsWith('…')).toBe(true);
    expect(snip.length).toBeLessThan(80);
  });

  it('falls back to a head slice when the query is not present', () => {
    expect(makeSnippet('short text', 'absent', 30)).toBe('short text');
  });
});

describe('mergeCardHits', () => {
  it('ranks title matches above note-only matches, then by recency, capped at limit', () => {
    const hits = [
      cardHit({ id: 'note-only', note: '수동태 메모', createdAt: '2026-06-30T00:00:00.000Z' }),
      cardHit({ id: 'title-old', title: '수동태 개념', createdAt: '2026-01-02T00:00:00.000Z' }),
      cardHit({ id: 'title-new', title: '수동태 끝내기', createdAt: '2026-06-01T00:00:00.000Z' }),
    ];
    const merged = mergeCardHits(hits, '수동태', 2);
    expect(merged.map((h) => h.id)).toEqual(['title-new', 'title-old']);
  });
});

describe('withGroupTimeout', () => {
  it('returns the group result when it beats the budget', async () => {
    const group = Promise.resolve({ items: [1], total: 1, partial: false });
    await expect(withGroupTimeout(group, 200)).resolves.toEqual({
      items: [1],
      total: 1,
      partial: false,
    });
  });

  it('yields empty + partial:true when the group misses the budget', async () => {
    const never = new Promise<{ items: number[]; total: number; partial: boolean }>(() => {});
    await expect(withGroupTimeout(never, 20)).resolves.toEqual({
      items: [],
      total: 0,
      partial: true,
    });
  });
});

describe('globalSearch — empty query guard', () => {
  it('returns all-empty groups without touching the DB when q trims to empty', async () => {
    const result = await globalSearch('00000000-0000-0000-0000-000000000000', '   ');
    expect(result.groups.cards).toEqual({ items: [], total: 0, partial: false });
    expect(result.groups.mandalas.items).toEqual([]);
    expect(result.groups.notes.items).toEqual([]);
    expect(result.groups.summaries.items).toEqual([]);
  });
});
