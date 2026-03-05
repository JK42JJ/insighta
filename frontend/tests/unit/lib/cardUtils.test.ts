/**
 * cardUtils Tests
 *
 * Tests for detectCardSource, getCardById, isCardInIdeation, isCardInMandala.
 * Focuses on the optional `card` parameter fallback added in the recent fix.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  detectCardSource,
  getCardById,
  isCardInIdeation,
  isCardInMandala,
} from '@/lib/cardUtils';
import type { InsightCard } from '@/types/mandala';

// ============================================
// Test Data Factories
// ============================================

function makeCard(overrides: Partial<InsightCard> = {}): InsightCard {
  return {
    id: 'card-abc123',
    videoUrl: 'https://youtube.com/watch?v=abc123',
    title: 'Test Card',
    thumbnail: 'https://example.com/thumb.jpg',
    userNote: '',
    createdAt: new Date('2024-01-01'),
    cellIndex: 0,
    levelId: 'level-1',
    ...overrides,
  };
}

// ============================================
// detectCardSource Tests
// ============================================

describe('detectCardSource', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  // --- Primary lookup: syncedCards ---

  describe('syncedCards lookup', () => {
    it('should return "synced" when cardId is found in syncedCards', () => {
      const card = makeCard({ id: 'card-001' });
      const result = detectCardSource('card-001', [card], [], undefined);
      expect(result).toBe('synced');
    });

    it('should return "synced" from syncedCards regardless of persistedLocalCards', () => {
      const synced = makeCard({ id: 'overlap-id' });
      const local = makeCard({ id: 'overlap-id' });
      const result = detectCardSource('overlap-id', [synced], [local], undefined);
      expect(result).toBe('synced');
    });

    it('should not emit a console.warn when found in syncedCards', () => {
      const card = makeCard({ id: 'card-001' });
      detectCardSource('card-001', [card], [], undefined);
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  // --- Secondary lookup: persistedLocalCards ---

  describe('persistedLocalCards lookup', () => {
    it('should return "local" when cardId is found in persistedLocalCards', () => {
      const card = makeCard({ id: 'local-001' });
      const result = detectCardSource('local-001', [], [card], undefined);
      expect(result).toBe('local');
    });

    it('should not emit a console.warn when found in persistedLocalCards', () => {
      const card = makeCard({ id: 'local-001' });
      detectCardSource('local-001', [], [card], undefined);
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  // --- Fallback: optional card parameter with isInIdeation ---

  describe('isInIdeation fallback (optional card parameter)', () => {
    it('should return "synced" when card.isInIdeation === true and not in either array', () => {
      const card = makeCard({ id: 'missing-id', isInIdeation: true });
      const result = detectCardSource('missing-id', [], [], card);
      expect(result).toBe('synced');
    });

    it('should return "synced" when card.isInIdeation === false and not in either array', () => {
      const card = makeCard({ id: 'missing-id', isInIdeation: false });
      const result = detectCardSource('missing-id', [], [], card);
      expect(result).toBe('synced');
    });

    it('should emit console.warn in dev mode when using isInIdeation fallback', () => {
      const card = makeCard({ id: 'missing-id', isInIdeation: true });
      detectCardSource('missing-id', [], [], card);
      // console.warn is gated by import.meta.env.DEV — vitest runs in dev mode
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('not in syncedCards but has isInIdeation=true')
      );
    });

    it('should return "pending" when card.isInIdeation === undefined and not in either array', () => {
      const card = makeCard({ id: 'missing-id' });
      delete (card as Partial<InsightCard>).isInIdeation;
      const result = detectCardSource('missing-id', [], [], card);
      expect(result).toBe('pending');
    });

    it('should return "pending" when card parameter is undefined', () => {
      const result = detectCardSource('missing-id', [], [], undefined);
      expect(result).toBe('pending');
    });

    it('should return "pending" when card parameter is null', () => {
      const result = detectCardSource('missing-id', [], [], null);
      expect(result).toBe('pending');
    });

    it('should not use fallback if card is found in syncedCards (syncedCards takes priority over isInIdeation)', () => {
      const synced = makeCard({ id: 'card-x', isInIdeation: false });
      const card = makeCard({ id: 'card-x', isInIdeation: true });
      const result = detectCardSource('card-x', [synced], [], card);
      expect(result).toBe('synced');
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('should not use fallback if card is found in persistedLocalCards', () => {
      const local = makeCard({ id: 'card-y' });
      const card = makeCard({ id: 'card-y', isInIdeation: true });
      const result = detectCardSource('card-y', [], [local], card);
      expect(result).toBe('local');
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  // --- Default "pending" case ---

  describe('"pending" default', () => {
    it('should return "pending" when cardId is not found in any source and no card provided', () => {
      const result = detectCardSource('nonexistent', [], [], undefined);
      expect(result).toBe('pending');
    });

    it('should return "pending" for empty arrays with no card parameter', () => {
      const result = detectCardSource('any-id', [], []);
      expect(result).toBe('pending');
    });
  });

  // --- Edge cases ---

  describe('edge cases', () => {
    it('should correctly match by id, not by reference', () => {
      const syncedCard = makeCard({ id: 'target' });
      const otherCard = makeCard({ id: 'other' });
      expect(detectCardSource('target', [otherCard, syncedCard], [])).toBe('synced');
    });

    it('should handle empty syncedCards with non-empty persistedLocalCards', () => {
      const localCard = makeCard({ id: 'loc-1' });
      expect(detectCardSource('loc-1', [], [localCard])).toBe('local');
    });

    it('should match first occurrence in syncedCards when duplicates exist', () => {
      const a = makeCard({ id: 'dup' });
      const b = makeCard({ id: 'dup' });
      expect(detectCardSource('dup', [a, b], [])).toBe('synced');
    });
  });
});

// ============================================
// getCardById Tests
// ============================================

describe('getCardById', () => {
  it('should return card from syncedCards when found', () => {
    const card = makeCard({ id: 'synced-1' });
    const result = getCardById('synced-1', [card], [], []);
    expect(result).toBe(card);
  });

  it('should return card from persistedLocalCards when not in syncedCards', () => {
    const card = makeCard({ id: 'local-1' });
    const result = getCardById('local-1', [], [card], []);
    expect(result).toBe(card);
  });

  it('should return card from pendingCards when not in synced or local', () => {
    const card = makeCard({ id: 'pending-1' });
    const result = getCardById('pending-1', [], [], [card]);
    expect(result).toBe(card);
  });

  it('should return null when cardId is not found anywhere', () => {
    const result = getCardById('nonexistent', [], [], []);
    expect(result).toBeNull();
  });

  it('should prioritise syncedCards over persistedLocalCards and pendingCards', () => {
    const synced = makeCard({ id: 'same-id', title: 'Synced' });
    const local = makeCard({ id: 'same-id', title: 'Local' });
    const pending = makeCard({ id: 'same-id', title: 'Pending' });
    const result = getCardById('same-id', [synced], [local], [pending]);
    expect(result?.title).toBe('Synced');
  });

  it('should prioritise persistedLocalCards over pendingCards', () => {
    const local = makeCard({ id: 'same-id', title: 'Local' });
    const pending = makeCard({ id: 'same-id', title: 'Pending' });
    const result = getCardById('same-id', [], [local], [pending]);
    expect(result?.title).toBe('Local');
  });
});

// ============================================
// isCardInIdeation Tests
// ============================================

describe('isCardInIdeation', () => {
  it('should return true when cellIndex is negative', () => {
    const card = makeCard({ cellIndex: -1, levelId: 'level-1' });
    expect(isCardInIdeation(card)).toBe(true);
  });

  it('should return true when levelId is absent (empty string)', () => {
    const card = makeCard({ cellIndex: 0, levelId: '' });
    expect(isCardInIdeation(card)).toBe(true);
  });

  it('should return true when levelId is "scratchpad"', () => {
    const card = makeCard({ cellIndex: 0, levelId: 'scratchpad' });
    expect(isCardInIdeation(card)).toBe(true);
  });

  it('should return false when cellIndex >= 0 and levelId is a real level', () => {
    const card = makeCard({ cellIndex: 0, levelId: 'level-1' });
    expect(isCardInIdeation(card)).toBe(false);
  });

  it('should return true when cellIndex is 0 and levelId is "scratchpad"', () => {
    const card = makeCard({ cellIndex: 0, levelId: 'scratchpad' });
    expect(isCardInIdeation(card)).toBe(true);
  });
});

// ============================================
// isCardInMandala Tests
// ============================================

describe('isCardInMandala', () => {
  it('should return true when cellIndex >= 0 and levelId is set and not "scratchpad"', () => {
    const card = makeCard({ cellIndex: 0, levelId: 'level-1' });
    expect(isCardInMandala(card)).toBe(true);
  });

  it('should return false when cellIndex is negative', () => {
    const card = makeCard({ cellIndex: -1, levelId: 'level-1' });
    expect(isCardInMandala(card)).toBe(false);
  });

  it('should return false when levelId is empty', () => {
    const card = makeCard({ cellIndex: 5, levelId: '' });
    expect(isCardInMandala(card)).toBe(false);
  });

  it('should return false when levelId is "scratchpad"', () => {
    const card = makeCard({ cellIndex: 3, levelId: 'scratchpad' });
    expect(isCardInMandala(card)).toBe(false);
  });

  it('should return true for a card at cellIndex 8 with a valid levelId', () => {
    const card = makeCard({ cellIndex: 8, levelId: 'sub-level-2' });
    expect(isCardInMandala(card)).toBe(true);
  });
});
