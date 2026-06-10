/**
 * cardSetKey — CP499 #2 regression. The visibleCount reset keys on this; it must
 * be order-INDEPENDENT so a re-sort (relevance pick / live background re-sort)
 * does NOT reset the lazy-pagination window (the infinite-skeleton bug), while a
 * SET change (cell switch / add / remove) still does.
 */
import { describe, test, it, expect, vi } from 'vitest';
import { cardSetKey, scrollCardSetContainerToTop } from './CardList';

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

/**
 * CP499+ — scroll-to-top on card-set change (prod 2026-06-10: mandala switch
 * kept the previous set's deep scroll offset → viewport past the new set's
 * first-page window → skeletons until a scroll nudge).
 */
describe('scrollCardSetContainerToTop (CP499+)', () => {
  it('scrolls the nearest [data-scroll-container] ancestor to top', () => {
    const scroller = document.createElement('div');
    scroller.setAttribute('data-scroll-container', '');
    const inner = document.createElement('div');
    scroller.appendChild(inner);
    const scrollTo = vi.fn();
    (scroller as unknown as { scrollTo: typeof scrollTo }).scrollTo = scrollTo;

    scrollCardSetContainerToTop(inner);
    expect(scrollTo).toHaveBeenCalledWith({ top: 0 });
  });

  it('is a no-op (no throw) without a scroll container or scrollTo (jsdom)', () => {
    const orphan = document.createElement('div');
    expect(() => scrollCardSetContainerToTop(orphan)).not.toThrow();
    expect(() => scrollCardSetContainerToTop(null)).not.toThrow();

    const scroller = document.createElement('div');
    scroller.setAttribute('data-scroll-container', '');
    const inner = document.createElement('div');
    scroller.appendChild(inner);
    // jsdom: Element.scrollTo undefined — optional call must not throw
    expect(() => scrollCardSetContainerToTop(inner)).not.toThrow();
  });
});
