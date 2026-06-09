/**
 * cardSetKey — CP499 #2 regression. The visibleCount reset keys on this; it must
 * be order-INDEPENDENT so a re-sort (relevance pick / live background re-sort)
 * does NOT reset the lazy-pagination window (the infinite-skeleton bug), while a
 * SET change (cell switch / add / remove) still does.
 */
import { describe, test, expect } from 'vitest';
import { cardSetKey } from './CardList';

describe('cardSetKey — order-independent set identity', () => {
  test('same cards REORDERED → SAME key (no visibleCount reset on re-sort)', () => {
    const a = [{ id: '1' }, { id: '2' }, { id: '3' }];
    const reordered = [{ id: '3' }, { id: '1' }, { id: '2' }];
    expect(cardSetKey(a)).toBe(cardSetKey(reordered));
  });

  test('different SET (cell switch) → DIFFERENT key (reset)', () => {
    expect(cardSetKey([{ id: '1' }, { id: '2' }])).not.toBe(cardSetKey([{ id: '1' }, { id: '3' }]));
  });

  test('add / remove a card → DIFFERENT key (reset)', () => {
    const base = [{ id: '1' }, { id: '2' }];
    expect(cardSetKey(base)).not.toBe(cardSetKey([...base, { id: '3' }]));
    expect(cardSetKey(base)).not.toBe(cardSetKey([{ id: '1' }]));
  });

  test('does not mutate the input order (sorts a copy)', () => {
    const a = [{ id: '3' }, { id: '1' }, { id: '2' }];
    cardSetKey(a);
    expect(a.map((c) => c.id)).toEqual(['3', '1', '2']);
  });
});
