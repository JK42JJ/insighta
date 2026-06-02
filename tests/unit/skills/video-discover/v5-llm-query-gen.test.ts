/**
 * v5 per-cell LLM query generation (CP492).
 * Verifies: good JSON → per-cell LLM queries; broken/partial/missing-key/throw
 * → rule-based fallback (per-cell + whole-call). No network (generateImpl inject).
 */

import {
  buildLLMQueriesPerCell,
  parsePerCellResponse,
} from '@/skills/plugins/video-discover/v5/llm-query-gen';

const INPUT = {
  centerGoal: '데일리 루틴으로 꾸준히 학습하며 온라인 창업하기',
  subGoals: [
    '매일 학습할 수 있는 시간 블록 설정 및 환경 구축',
    '온라인 창업에 필요한 핵심 기술 스택 선정',
    '창업 아이디어 발굴 및 시장 타당성 검증',
  ],
  focusTags: [] as string[],
  targetLevel: 'standard',
  language: 'ko' as const,
};

const GOOD_JSON = JSON.stringify({
  '0': '공부 시간관리 루틴',
  '1': '온라인 창업 기술 스택',
  '2': '창업 아이디어 시장 검증',
});

describe('parsePerCellResponse', () => {
  it('parses a plain JSON object', () => {
    const m = parsePerCellResponse(GOOD_JSON, 3);
    expect(m).not.toBeNull();
    expect(m!.get(0)).toBe('공부 시간관리 루틴');
    expect(m!.size).toBe(3);
  });

  it('tolerates code fences and surrounding prose', () => {
    const raw = 'Here you go:\n```json\n' + GOOD_JSON + '\n```\nDone.';
    const m = parsePerCellResponse(raw, 3);
    expect(m!.get(2)).toBe('창업 아이디어 시장 검증');
  });

  it('rejects out-of-range keys, empty and sentence-length values', () => {
    const raw = JSON.stringify({
      '0': '공부 시간관리 루틴',
      '1': '   ',
      '2': 'x'.repeat(80),
      '9': '범위 밖',
    });
    const m = parsePerCellResponse(raw, 3);
    expect(m!.size).toBe(1);
    expect(m!.get(0)).toBe('공부 시간관리 루틴');
  });

  it('returns null on unparseable input', () => {
    expect(parsePerCellResponse('not json at all', 3)).toBeNull();
    expect(parsePerCellResponse('', 3)).toBeNull();
  });
});

describe('buildLLMQueriesPerCell', () => {
  it('uses LLM queries per cell on good JSON', async () => {
    const out = await buildLLMQueriesPerCell(INPUT, {
      openRouterApiKey: 'k',
      generateImpl: async () => GOOD_JSON,
    });
    const llm = out.filter((q) => q.source === 'llm');
    expect(llm).toHaveLength(3);
    expect(llm.find((q) => q.cellIndex === 0)?.query).toBe('공부 시간관리 루틴');
    expect(llm.find((q) => q.cellIndex === 2)?.query).toBe('창업 아이디어 시장 검증');
  });

  it('falls back to rule-based when no API key', async () => {
    const out = await buildLLMQueriesPerCell(INPUT, { generateImpl: async () => GOOD_JSON });
    expect(out.every((q) => q.source !== 'llm')).toBe(true);
    expect(out.length).toBeGreaterThan(0);
  });

  it('falls back to rule-based on unparseable LLM output', async () => {
    const out = await buildLLMQueriesPerCell(INPUT, {
      openRouterApiKey: 'k',
      generateImpl: async () => 'garbage not json',
    });
    expect(out.every((q) => q.source !== 'llm')).toBe(true);
  });

  it('falls back to rule-based when the LLM call throws', async () => {
    const out = await buildLLMQueriesPerCell(INPUT, {
      openRouterApiKey: 'k',
      generateImpl: async () => {
        throw new Error('timeout');
      },
    });
    expect(out.every((q) => q.source !== 'llm')).toBe(true);
    expect(out.length).toBeGreaterThan(0);
  });

  it('per-cell fallback: LLM for present cells, rule for missing cells', async () => {
    // LLM only returns cell 0 → cells 1,2 should be filled from rule-based.
    const out = await buildLLMQueriesPerCell(INPUT, {
      openRouterApiKey: 'k',
      generateImpl: async () => JSON.stringify({ '0': '공부 시간관리 루틴' }),
    });
    const cell0 = out.find((q) => q.cellIndex === 0);
    expect(cell0?.source).toBe('llm');
    expect(cell0?.query).toBe('공부 시간관리 루틴');
    // cells 1 and 2 present from rule fallback (source 'subgoal')
    expect(out.find((q) => q.cellIndex === 1)?.source).toBe('subgoal');
    expect(out.find((q) => q.cellIndex === 2)?.source).toBe('subgoal');
  });

  it('returns [] for empty centerGoal', async () => {
    const out = await buildLLMQueriesPerCell(
      { ...INPUT, centerGoal: '  ' },
      { openRouterApiKey: 'k' }
    );
    expect(out).toEqual([]);
  });
});
