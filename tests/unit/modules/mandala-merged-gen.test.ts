/**
 * CP493 — merged structure+queries generation (generateMandalaWithQueries).
 *
 * One Haiku call yields the mandala structure AND a searchable per-cell query,
 * so the query inherits the goal-structure context (anti-clustering). Tests the
 * parse/validate/degrade/override logic with an injected generate impl — no
 * network. searchMandalasByGoal is mocked (no pgvector).
 */

jest.mock('@/modules/mandala/search', () => ({
  searchMandalasByGoal: jest.fn().mockResolvedValue([]),
  formatMandalasForFewShot: jest.fn().mockReturnValue(''),
}));

import {
  parseMergedResponse,
  generateMandalaWithQueries,
  MandalaGenError,
} from '@/modules/mandala/generator';

const SUB_GOALS = Array.from({ length: 8 }, (_, i) => `sub goal ${i}`);
const SUB_LABELS = Array.from({ length: 8 }, (_, i) => `label ${i}`);

function mergedJson(cellQueries: Record<string, string> | null, subGoals = SUB_GOALS): string {
  const obj: Record<string, unknown> = {
    center_goal: 'IGNORED_BY_OVERRIDE',
    center_label: 'short',
    language: 'ko',
    domain: 'general',
    sub_goals: subGoals,
    sub_labels: SUB_LABELS,
  };
  if (cellQueries) obj['cell_queries'] = cellQueries;
  return JSON.stringify(obj);
}

const FULL_CQ: Record<string, string> = Object.fromEntries(
  Array.from({ length: 8 }, (_, i) => [String(i), `검색어${i} 키워드`])
);

describe('parseMergedResponse', () => {
  test('valid merged JSON → structure + full cellQueries map', () => {
    const out = parseMergedResponse(mergedJson(FULL_CQ));
    expect(out).not.toBeNull();
    expect(out!.structure.sub_goals).toHaveLength(8);
    expect(out!.cellQueries?.size).toBe(8);
    expect(out!.cellQueries?.get(0)).toBe('검색어0 키워드');
  });

  test('missing cell_queries → structure present, cellQueries null (degrade)', () => {
    const out = parseMergedResponse(mergedJson(null));
    expect(out).not.toBeNull();
    expect(out!.structure.sub_goals).toHaveLength(8);
    expect(out!.cellQueries).toBeNull();
  });

  test('drops out-of-range / empty / over-long query entries', () => {
    const cq = {
      '0': 'ok query',
      '1': '   ', // empty after trim
      '9': 'out of range',
      '2': 'x'.repeat(61), // > MAX 60 chars
      '3': 'fine query',
    };
    const out = parseMergedResponse(mergedJson(cq));
    expect(out!.cellQueries?.size).toBe(2); // only 0 and 3
    expect(out!.cellQueries?.has(1)).toBe(false);
    expect(out!.cellQueries?.has(9 as number)).toBe(false);
    expect(out!.cellQueries?.has(2)).toBe(false);
  });

  test('unparseable structure → null', () => {
    expect(parseMergedResponse('not json at all')).toBeNull();
  });
});

describe('generateMandalaWithQueries', () => {
  const baseInput = { goal: '한국어 목표', language: 'ko' as const };

  test('full coverage → 8 cellQueries, not degraded, center_goal overridden', async () => {
    const res = await generateMandalaWithQueries(baseInput, {
      generateImpl: async () => mergedJson(FULL_CQ),
    });
    expect(res.structure.center_goal).toBe('한국어 목표'); // HARD RULE override
    expect(res.cellQueries).toHaveLength(8);
    expect(res.cellQueries?.[0]).toEqual({ cellIndex: 0, query: '검색어0 키워드' });
    expect(res.meta.degraded).toBe(false);
    expect(res.meta.cellQueryCount).toBe(8);
  });

  test('partial coverage → cellQueries undefined (degraded), structure still returned', async () => {
    const partial = { '0': '검색어0 키워드', '1': '검색어1 키워드', '2': '검색어2 키워드' };
    const res = await generateMandalaWithQueries(baseInput, {
      generateImpl: async () => mergedJson(partial),
    });
    expect(res.cellQueries).toBeUndefined(); // partial → fanout runs query-gen
    expect(res.meta.degraded).toBe(true);
    expect(res.meta.cellQueryCount).toBe(3);
    expect(res.structure.sub_goals).toHaveLength(8);
  });

  test('invalid structure (sub_goals != 8) → throws MandalaGenError', async () => {
    await expect(
      generateMandalaWithQueries(baseInput, {
        generateImpl: async () => mergedJson(FULL_CQ, ['only', 'five', 'sub', 'goals', 'here']),
      })
    ).rejects.toThrow(MandalaGenError);
  });

  test('unparseable response → throws MandalaGenError', async () => {
    await expect(
      generateMandalaWithQueries(baseInput, { generateImpl: async () => 'garbage' })
    ).rejects.toThrow(MandalaGenError);
  });
});
