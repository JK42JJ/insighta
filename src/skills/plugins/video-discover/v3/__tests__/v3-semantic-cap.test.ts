/**
 * Tests for V3_SEMANTIC_MAX_CANDIDATES env + config (Issue #543, CP436 PR-Y0b2).
 *
 * Direct unit-level coverage of the cap parsing + default. Integration of the
 * cap inside `executor.ts:751` is exercised indirectly by `v3-upsert-slots.test.ts`;
 * here we verify the wiring (env → zod → config) so a future env-rename or
 * default-tweak doesn't silently break the safety net.
 */

import { loadV3Config, DEFAULT_SEMANTIC_MAX_CANDIDATES, v3EnvSchema } from '../config';

describe('v3 config — semanticMaxCandidates (PR-Y0b2)', () => {
  test('default = 30 when env unset', () => {
    const cfg = loadV3Config({});
    expect(cfg.semanticMaxCandidates).toBe(DEFAULT_SEMANTIC_MAX_CANDIDATES);
    expect(DEFAULT_SEMANTIC_MAX_CANDIDATES).toBe(30);
  });

  test('valid integer override applies', () => {
    const cfg = loadV3Config({ V3_SEMANTIC_MAX_CANDIDATES: '50' });
    expect(cfg.semanticMaxCandidates).toBe(50);
  });

  test('lower bound = 1', () => {
    const cfg = loadV3Config({ V3_SEMANTIC_MAX_CANDIDATES: '1' });
    expect(cfg.semanticMaxCandidates).toBe(1);
  });

  test('upper bound = 200', () => {
    const cfg = loadV3Config({ V3_SEMANTIC_MAX_CANDIDATES: '200' });
    expect(cfg.semanticMaxCandidates).toBe(200);
  });

  test('zero / negative / out-of-range falls back to default', () => {
    // Zod refuses values < 1 or > 200 — entire schema parse fails, loadV3Config
    // returns the all-defaults shape.
    const cfg = loadV3Config({ V3_SEMANTIC_MAX_CANDIDATES: '500' });
    expect(cfg.semanticMaxCandidates).toBe(DEFAULT_SEMANTIC_MAX_CANDIDATES);
  });

  test('non-numeric string falls back to default', () => {
    const cfg = loadV3Config({ V3_SEMANTIC_MAX_CANDIDATES: 'not-a-number' });
    expect(cfg.semanticMaxCandidates).toBe(DEFAULT_SEMANTIC_MAX_CANDIDATES);
  });

  test('schema rejects 0', () => {
    const r = v3EnvSchema.safeParse({ V3_SEMANTIC_MAX_CANDIDATES: '0' });
    expect(r.success).toBe(false);
  });

  test('schema rejects 201', () => {
    const r = v3EnvSchema.safeParse({ V3_SEMANTIC_MAX_CANDIDATES: '201' });
    expect(r.success).toBe(false);
  });
});
