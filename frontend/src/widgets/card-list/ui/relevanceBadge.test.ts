/**
 * CP499 #4 — getRelevanceBadge: the revived A-stage relevance badge.
 *
 * Reads the USER-SCOPED relevance_pct (InsightCard.relevancePct), shown only
 * when non-null (display = stored value). null ⇒ no badge (unscored card →
 * appears once wizard/manual/backfill fills it). Color tiers: ≥90 / ≥80 / ≥70 /
 * else. Distinct from the video-keyed mandala_relevance_pct (dot/SSE signal).
 */
import { describe, it, expect } from 'vitest';
import { getRelevanceBadge } from './InsightCardItemV2';

describe('getRelevanceBadge — user-scoped relevance display', () => {
  it('null / undefined ⇒ no badge (unscored card hidden)', () => {
    expect(getRelevanceBadge(null)).toBeNull();
    expect(getRelevanceBadge(undefined)).toBeNull();
  });

  it('renders "<n>%" and clamps to 0..100', () => {
    expect(getRelevanceBadge(82)?.label).toBe('82%');
    expect(getRelevanceBadge(0)?.label).toBe('0%'); // 0 is a score, shown (not null)
    expect(getRelevanceBadge(140)?.label).toBe('100%');
    expect(getRelevanceBadge(-5)?.label).toBe('0%');
  });

  it('color tiers: ≥90 indigo / ≥80 green / ≥70 amber / else gray', () => {
    expect(getRelevanceBadge(95)?.className).toContain('#818cf8'); // high
    expect(getRelevanceBadge(82)?.className).toContain('#34d399'); // mid
    expect(getRelevanceBadge(72)?.className).toContain('#fbbf24'); // low
    expect(getRelevanceBadge(40)?.className).toContain('#94a3b8'); // below
  });
});
