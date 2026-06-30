/**
 * getRelevanceBadge — relevance TIER badge (raw % replaced by 핵심/추천 tiers).
 *
 * Reads the USER-SCOPED relevance_pct (InsightCard.relevancePct). The raw score
 * is never rendered — only a tier label, with the exact value on hover (`raw`).
 * Tiers: ≥80 → "핵심" (spark), 70–79 → "추천" (ghost), <70 / null ⇒ no badge.
 * Single indigo ladder on --primary; no traffic-light green/amber.
 */
import { describe, it, expect } from 'vitest';
import { getRelevanceBadge } from './InsightCardItemV2';

describe('getRelevanceBadge — relevance tier display', () => {
  it('null / undefined ⇒ no badge (unscored card hidden)', () => {
    expect(getRelevanceBadge(null)).toBeNull();
    expect(getRelevanceBadge(undefined)).toBeNull();
  });

  it('<70 (gate-passed but low) ⇒ no badge (number never shown)', () => {
    expect(getRelevanceBadge(69)).toBeNull();
    expect(getRelevanceBadge(40)).toBeNull();
    expect(getRelevanceBadge(0)).toBeNull();
  });

  it('≥80 ⇒ "핵심" tier with spark glyph', () => {
    const b = getRelevanceBadge(85);
    expect(b?.tier).toBe('core');
    expect(b?.label).toBe('핵심');
    expect(b?.showSpark).toBe(true);
  });

  it('70–79 ⇒ "추천" tier, no glyph', () => {
    const b = getRelevanceBadge(72);
    expect(b?.tier).toBe('pick');
    expect(b?.label).toBe('추천');
    expect(b?.showSpark).toBe(false);
  });

  it('keeps the raw score (for the hover tooltip) and clamps to 0..100', () => {
    expect(getRelevanceBadge(82)?.raw).toBe(82);
    expect(getRelevanceBadge(140)?.raw).toBe(100);
    expect(getRelevanceBadge(80.4)?.raw).toBe(80);
  });

  it('uses the --primary indigo token, never traffic-light green/amber', () => {
    expect(getRelevanceBadge(95)?.className).toContain('--primary');
    expect(getRelevanceBadge(72)?.className).toContain('--primary');
    expect(getRelevanceBadge(95)?.className).not.toContain('#34d399');
    expect(getRelevanceBadge(72)?.className).not.toContain('#fbbf24');
  });
});
