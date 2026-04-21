/**
 * Phase 1 slice 3 — normalizeStructureLabels (label pass-through and
 * trimming from the structure-generation response).
 *
 * Covers the parse-time normalization the `generateMandalaStructure`
 * path uses to either (a) accept in-band labels produced by the
 * structure prompt and skip the enrichLabels fallback, or (b) delete
 * malformed labels so enrichLabels falls back cleanly.
 */

import { normalizeStructureLabels } from '@/modules/mandala/generator';

describe('normalizeStructureLabels — slice 3 in-band label parsing', () => {
  test('valid 8-element sub_labels → hadSubLabels=true + trimmed to EN cap 15', () => {
    const parsed: {
      center_label?: unknown;
      sub_labels?: unknown;
      sub_goals: unknown[];
    } = {
      center_label: 'Focus on Daily Habit Building',
      sub_labels: [
        'Morning Routine Extensive Block',
        'Night Routine Calm',
        'Deep Work',
        'Fitness Minimal',
        'Mindfulness Clear',
        'Daily Reading',
        'Environment Reset',
        'Habit Science Book',
      ],
      sub_goals: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
    };
    const { hadSubLabels } = normalizeStructureLabels(parsed, 'en');
    expect(hadSubLabels).toBe(true);
    expect(parsed.center_label).toBe('Focus on Daily ');
    expect((parsed.sub_labels as string[]).every((l) => l.length <= 15)).toBe(true);
    expect((parsed.sub_labels as string[])[0]).toBe('Morning Routine');
  });

  test('valid 8-element sub_labels in KO → trimmed to cap 10', () => {
    const parsed: {
      center_label?: unknown;
      sub_labels?: unknown;
      sub_goals: unknown[];
    } = {
      center_label: '인생을바꾸는데일리루틴완성',
      sub_labels: [
        '아침루틴 확장 세션',
        '저녁 수면 정비 루틴',
        '딥워크 집중 시간',
        '건강 운동 15분',
        '마음챙김 명상',
        '자기계발 독서 루틴',
        '환경 정리 디지털 관리',
        '습관 과학 66일 뇌과학',
      ],
      sub_goals: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
    };
    const { hadSubLabels } = normalizeStructureLabels(parsed, 'ko');
    expect(hadSubLabels).toBe(true);
    expect((parsed.center_label as string).length).toBeLessThanOrEqual(10);
    expect((parsed.sub_labels as string[]).every((l) => l.length <= 10)).toBe(true);
  });

  test('sub_labels count mismatch (7 vs 8 sub_goals) → deleted', () => {
    const parsed: {
      center_label?: unknown;
      sub_labels?: unknown;
      sub_goals: unknown[];
    } = {
      center_label: 'Center',
      sub_labels: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
      sub_goals: ['g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7', 'g8'],
    };
    const { hadSubLabels } = normalizeStructureLabels(parsed, 'en');
    expect(hadSubLabels).toBe(false);
    expect(parsed.sub_labels).toBeUndefined();
    // center_label still trimmed
    expect(parsed.center_label).toBe('Center');
  });

  test('sub_labels contains empty string → deleted (partial labels rejected)', () => {
    const parsed: {
      center_label?: unknown;
      sub_labels?: unknown;
      sub_goals: unknown[];
    } = {
      center_label: 'Center',
      sub_labels: ['a', 'b', 'c', 'd', 'e', '', 'g', 'h'],
      sub_goals: ['g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7', 'g8'],
    };
    const { hadSubLabels } = normalizeStructureLabels(parsed, 'en');
    expect(hadSubLabels).toBe(false);
    expect(parsed.sub_labels).toBeUndefined();
  });

  test('sub_labels is undefined → hadSubLabels=false, center_label still trimmed', () => {
    const parsed: {
      center_label?: unknown;
      sub_labels?: unknown;
      sub_goals: unknown[];
    } = {
      center_label: 'This is a very long center label indeed',
      sub_goals: ['g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7', 'g8'],
    };
    const { hadSubLabels } = normalizeStructureLabels(parsed, 'en');
    expect(hadSubLabels).toBe(false);
    expect(parsed.sub_labels).toBeUndefined();
    expect(parsed.center_label).toBe('This is a very ');
  });

  test('center_label is non-string → deleted (only string labels accepted)', () => {
    const parsed: {
      center_label?: unknown;
      sub_labels?: unknown;
      sub_goals: unknown[];
    } = {
      center_label: 42,
      sub_labels: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
      sub_goals: ['g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7', 'g8'],
    };
    const { hadSubLabels } = normalizeStructureLabels(parsed, 'en');
    expect(hadSubLabels).toBe(true);
    expect(parsed.center_label).toBeUndefined();
  });

  test('sub_labels contains non-string entry → deleted', () => {
    const parsed: {
      center_label?: unknown;
      sub_labels?: unknown;
      sub_goals: unknown[];
    } = {
      center_label: 'Center',
      sub_labels: ['a', 'b', 'c', 42, 'e', 'f', 'g', 'h'],
      sub_goals: ['g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7', 'g8'],
    };
    const { hadSubLabels } = normalizeStructureLabels(parsed, 'en');
    expect(hadSubLabels).toBe(false);
    expect(parsed.sub_labels).toBeUndefined();
  });
});
