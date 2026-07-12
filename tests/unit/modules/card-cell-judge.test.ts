/**
 * gA judge — prompt contract (no descriptions/examples), parse fail-open,
 * deboost-only semantics (2026-07-12).
 */
import {
  buildJudgePrompt,
  parseJudgeResponse,
  judgeCellCards,
} from '@/modules/judge/card-cell-judge';

jest.mock('@/modules/llm/openrouter', () => ({
  OpenRouterGenerationProvider: jest.fn(),
}));
jest.mock('@/utils/logger', () => ({
  logger: { child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }) },
}));

const items = [
  { videoId: 'aaa', title: '하프마라톤 페이스 훈련법' },
  { videoId: 'bbb', title: '퇴사하고 세계여행 갔다온 썰' },
];

describe('buildJudgePrompt — 금지 조항 준수', () => {
  const p = buildJudgePrompt({ centerGoal: '하프 마라톤 완주', cellTopic: '페이싱 전략', items });
  test('제목·셀주제·중심목표만 포함, 앵커 문장 포함', () => {
    expect(p).toContain('셀 주제: 페이싱 전략');
    expect(p).toContain('중심 목표: 하프 마라톤 완주');
    expect(p).toContain('셀의 주제 단독');
    expect(p).toContain('1. 하프마라톤 페이스 훈련법');
  });
  test('설명문/예시 미포함 (입력 계약)', () => {
    expect(p).not.toMatch(/설명문:|예시:/);
  });
});

describe('parseJudgeResponse', () => {
  test('정상 JSON + fenced block 허용', () => {
    const out = parseJudgeResponse('```json\n[{"n":1,"fit":true},{"n":2,"fit":false}]\n```', items);
    expect(out).toEqual([
      { videoId: 'aaa', fit: true },
      { videoId: 'bbb', fit: false },
    ]);
  });
  test('누락 항목은 fit (per-item fail-open)', () => {
    const out = parseJudgeResponse('[{"n":2,"fit":false}]', items);
    expect(out![0]).toEqual({ videoId: 'aaa', fit: true });
  });
  test('파싱 불가 → null', () => {
    expect(parseJudgeResponse('nonsense', items)).toBeNull();
  });
});

describe('judgeCellCards — fail-open', () => {
  test('provider throw → 전원 fit', async () => {
    const out = await judgeCellCards({
      centerGoal: 'g',
      cellTopic: 'c',
      items,
      generateImpl: async () => {
        throw new Error('down');
      },
    });
    expect(out.every((v) => v.fit)).toBe(true);
  });
  test('unfit 판정 전달', async () => {
    const out = await judgeCellCards({
      centerGoal: 'g',
      cellTopic: 'c',
      items,
      generateImpl: async () => '[{"n":1,"fit":true},{"n":2,"fit":false}]',
    });
    expect(out[1]).toEqual({ videoId: 'bbb', fit: false });
  });
});
