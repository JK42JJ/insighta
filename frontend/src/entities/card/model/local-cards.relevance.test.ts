/**
 * CP498 PR3c — user-scoped relevance plumbing on the ulc converter
 * (user_local_cards.relevance_pct → InsightCard.relevancePct).
 *
 * Guards that the per-row, user-scoped score flows through — and stays distinct
 * from the video-keyed v2_mandala_relevance_pct (which must never drive sort).
 */
import { describe, it, expect } from 'vitest';
import { localCardToInsightCard } from './local-cards';
import type { LocalCard } from './local-cards';

function baseCard(): LocalCard {
  return {
    id: 'lc-1',
    user_id: 'user-1',
    url: 'https://example.com/article',
    title: 'An article',
    thumbnail: null,
    link_type: 'url',
    user_note: null,
    metadata_title: null,
    metadata_description: null,
    metadata_image: null,
    cell_index: 2,
    level_id: 'root',
    mandala_id: 'mandala-1',
    sort_order: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

describe('localCardToInsightCard — relevance plumbing', () => {
  it('maps ulc.relevance_pct → relevancePct', () => {
    expect(localCardToInsightCard({ ...baseCard(), relevance_pct: 41 }).relevancePct).toBe(41);
  });

  it('relevancePct defaults to null when relevance_pct is absent', () => {
    expect(localCardToInsightCard(baseCard()).relevancePct).toBeNull();
  });

  it('does NOT source relevancePct from the video-keyed v2_mandala_relevance_pct', () => {
    // v2 (leaky) populated, user-scoped absent ⇒ relevancePct must stay null.
    const card = localCardToInsightCard({ ...baseCard(), v2_mandala_relevance_pct: 99 });
    expect(card.relevancePct).toBeNull();
    expect(card.v2MandalaRelevancePct).toBe(99);
  });
});
