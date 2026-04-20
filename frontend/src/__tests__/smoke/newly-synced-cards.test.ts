/**
 * Issue #389 — "Newly Synced" card predicate + per-mandala aggregation.
 *
 * Pins the filter logic that drives:
 *   - the mandala-level "Newly Synced" tab (LabelFilterPillsV2)
 *   - the sidebar dot+count indicator (SidebarMandalaSection)
 *
 * Predicate (isNewlySyncedCard):
 *   - isInIdeation === false
 *   - cellIndex < 0 (or missing)
 *   - mandalaId is set
 *   - (optional) filter to a specific mandala
 *
 * Aggregation (countNewlySyncedByMandala):
 *   - groups by mandalaId; mandalas with 0 newly-synced are omitted
 */
import { describe, expect, it } from 'vitest';
import {
  isNewlySyncedCard,
  countNewlySyncedByMandala,
} from '@/features/card-management/lib/cardUtils';
import type { InsightCard } from '@/entities/card/model/types';

const MANDALA_A = 'mandala-a';
const MANDALA_B = 'mandala-b';

function makeCard(partial: Partial<InsightCard>): InsightCard {
  // Fill required InsightCard fields with benign defaults; the predicate
  // only reads isInIdeation / cellIndex / mandalaId, so the rest are
  // stubbed to satisfy the type without affecting behavior.
  return {
    id: partial.id ?? 'card-1',
    title: partial.title ?? 'Sample',
    videoUrl: partial.videoUrl ?? 'https://example.com/v',
    thumbnail: partial.thumbnail ?? '',
    linkType: partial.linkType ?? 'youtube',
    cellIndex: partial.cellIndex ?? -1,
    levelId: partial.levelId ?? 'scratchpad',
    mandalaId: partial.mandalaId ?? null,
    isInIdeation: partial.isInIdeation ?? true,
    createdAt: partial.createdAt ?? new Date(),
    ...partial,
  } as InsightCard;
}

describe('isNewlySyncedCard', () => {
  it('returns true for a mapped-but-unplaced card', () => {
    const card = makeCard({
      isInIdeation: false,
      cellIndex: -1,
      mandalaId: MANDALA_A,
    });
    expect(isNewlySyncedCard(card)).toBe(true);
  });

  it('returns false when still in global Ideation (is_in_ideation=true)', () => {
    const card = makeCard({
      isInIdeation: true,
      cellIndex: -1,
      mandalaId: MANDALA_A,
    });
    expect(isNewlySyncedCard(card)).toBe(false);
  });

  it('returns false when already placed into a cell (cellIndex >= 0)', () => {
    const card = makeCard({
      isInIdeation: false,
      cellIndex: 3,
      mandalaId: MANDALA_A,
    });
    expect(isNewlySyncedCard(card)).toBe(false);
  });

  it('returns false when mandalaId is null (unmapped sync)', () => {
    const card = makeCard({
      isInIdeation: false,
      cellIndex: -1,
      mandalaId: null,
    });
    expect(isNewlySyncedCard(card)).toBe(false);
  });

  it('filters to a specific mandala when mandalaId arg is provided', () => {
    const cardInA = makeCard({
      id: 'a',
      isInIdeation: false,
      cellIndex: -1,
      mandalaId: MANDALA_A,
    });
    const cardInB = makeCard({
      id: 'b',
      isInIdeation: false,
      cellIndex: -1,
      mandalaId: MANDALA_B,
    });
    expect(isNewlySyncedCard(cardInA, MANDALA_A)).toBe(true);
    expect(isNewlySyncedCard(cardInB, MANDALA_A)).toBe(false);
  });

  it('treats missing cellIndex (non-number) as unplaced', () => {
    const card = makeCard({
      isInIdeation: false,
      mandalaId: MANDALA_A,
    });
    // typescript enforces cellIndex as number; simulate undefined via cast.
    (card as unknown as { cellIndex: unknown }).cellIndex = undefined;
    expect(isNewlySyncedCard(card)).toBe(true);
  });
});

describe('countNewlySyncedByMandala', () => {
  it('aggregates counts per mandala, excluding non-newly-synced cards', () => {
    const cards: InsightCard[] = [
      makeCard({ id: '1', isInIdeation: false, cellIndex: -1, mandalaId: MANDALA_A }),
      makeCard({ id: '2', isInIdeation: false, cellIndex: -1, mandalaId: MANDALA_A }),
      makeCard({ id: '3', isInIdeation: false, cellIndex: -1, mandalaId: MANDALA_B }),
      // placed card — ignored
      makeCard({ id: '4', isInIdeation: false, cellIndex: 0, mandalaId: MANDALA_A }),
      // still-in-ideation — ignored
      makeCard({ id: '5', isInIdeation: true, cellIndex: -1, mandalaId: MANDALA_A }),
      // unmapped — ignored
      makeCard({ id: '6', isInIdeation: false, cellIndex: -1, mandalaId: null }),
    ];

    const counts = countNewlySyncedByMandala(cards);
    expect(counts).toEqual({
      [MANDALA_A]: 2,
      [MANDALA_B]: 1,
    });
  });

  it('omits mandalas with 0 newly-synced from the result (missing key ≡ 0)', () => {
    const cards: InsightCard[] = [
      makeCard({ id: '1', isInIdeation: false, cellIndex: 0, mandalaId: MANDALA_A }),
    ];
    const counts = countNewlySyncedByMandala(cards);
    expect(counts).not.toHaveProperty(MANDALA_A);
    expect(Object.keys(counts)).toHaveLength(0);
  });

  it('returns empty object for empty input (no mandalas)', () => {
    expect(countNewlySyncedByMandala([])).toEqual({});
  });
});
