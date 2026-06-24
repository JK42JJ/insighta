/**
 * isCompleteV2 — the on-demand enrich handler's cache-hit guard. A complete
 * GLOBAL v2 (transcript-grounded + relevance) must short-circuit so re-enrich
 * (Heart re-click etc.) does NOT re-call Haiku+Sonnet for already-cached content.
 */
import { isCompleteV2 } from '../../src/modules/queue/handlers/v2-completeness';

describe('isCompleteV2 (enrich cache-hit guard)', () => {
  it('complete v2 (transcript + relevance) → cache hit', () => {
    expect(isCompleteV2({ template_version: 'v2', transcript_used: true, mandala_relevance_pct: 70 })).toBe(true);
  });
  it('description-only v2 (no transcript) → NOT complete (regen)', () => {
    expect(isCompleteV2({ template_version: 'v2', transcript_used: false, mandala_relevance_pct: 70 })).toBe(false);
  });
  it('v2 without relevance → NOT complete (regen)', () => {
    expect(isCompleteV2({ template_version: 'v2', transcript_used: true, mandala_relevance_pct: null })).toBe(false);
  });
  it('v1 row → NOT complete (regen)', () => {
    expect(isCompleteV2({ template_version: 'v1', transcript_used: true, mandala_relevance_pct: 70 })).toBe(false);
  });
  it('no row → NOT complete', () => {
    expect(isCompleteV2(null)).toBe(false);
  });
});
