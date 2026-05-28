/**
 * CP489 — Unit tests for buildEphemeralFocusTags.
 *
 * Why: the wiring this helper fixes was silent (FE chip keyword
 * `extraKeywords` was parsed + traced but never forwarded into the
 * Tier 2 keyword-builder). This test pins the merge contract so a
 * future refactor cannot revert to the silent behavior.
 */

import { buildEphemeralFocusTags } from '../../../src/api/routes/add-cards';

describe('buildEphemeralFocusTags (CP489 chip→focusTags wiring)', () => {
  it('returns empty array when both inputs are empty', () => {
    expect(buildEphemeralFocusTags([], [])).toEqual([]);
    expect(buildEphemeralFocusTags(null, [])).toEqual([]);
    expect(buildEphemeralFocusTags(undefined, [])).toEqual([]);
  });

  it('returns only mandala defaults when extraKeywords is empty', () => {
    expect(buildEphemeralFocusTags(['뇌과학', '학습법'], [])).toEqual(['뇌과학', '학습법']);
  });

  it('returns only extraKeywords when mandala defaults are empty', () => {
    expect(buildEphemeralFocusTags(null, ['오태민', '심화'])).toEqual(['오태민', '심화']);
  });

  it('puts extraKeywords first (user intent wins over mandala defaults)', () => {
    const out = buildEphemeralFocusTags(['뇌과학'], ['오태민']);
    expect(out).toEqual(['오태민', '뇌과학']);
  });

  it('dedupes case-insensitively across both lists', () => {
    const out = buildEphemeralFocusTags(['Brain'], ['brain', 'BRAIN']);
    expect(out).toEqual(['brain']);
  });

  it('drops empty / whitespace-only / non-string entries', () => {
    const out = buildEphemeralFocusTags(
      ['', '   ', null as unknown as string, '뇌과학'],
      [undefined as unknown as string, '   ', '오태민']
    );
    expect(out).toEqual(['오태민', '뇌과학']);
  });

  it('caps the merged list at the default cap (10)', () => {
    const mandala = Array.from({ length: 8 }, (_, i) => `m${i}`);
    const extras = Array.from({ length: 8 }, (_, i) => `e${i}`);
    const out = buildEphemeralFocusTags(mandala, extras);
    expect(out).toHaveLength(10);
    // extras win on the first 8 slots, then the first 2 mandala defaults
    expect(out).toEqual(['e0', 'e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'm0', 'm1']);
  });

  it('honors a custom cap parameter', () => {
    const out = buildEphemeralFocusTags(['m0', 'm1', 'm2'], ['e0', 'e1', 'e2'], 3);
    expect(out).toEqual(['e0', 'e1', 'e2']);
  });

  it('trims surrounding whitespace before dedupe', () => {
    const out = buildEphemeralFocusTags(['  뇌과학  '], ['뇌과학']);
    expect(out).toEqual(['뇌과학']);
  });
});
