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
  it('carries the subject-mismatch clause (2026-07-13 — human-psych in 개의 심리 cell)', () => {
    const prompt = buildJudgePrompt({
      centerGoal: '반려견 기본 훈련 배우기',
      cellTopic: '개의 심리',
      items: [{ videoId: 'a', title: '심리학과에서 배우는 인지발달이론' }],
    });
    expect(prompt).toContain('학습 대상과 다른 대상');
    expect(prompt).toContain('사람·아동·학생·내담자');
  });

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

describe('judgeCellCards — unanimous 2-judge + fail-open', () => {
  test('provider throw (both legs) → 전원 fit', async () => {
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
  test('만장일치 unfit → sink', async () => {
    const out = await judgeCellCards({
      centerGoal: 'g',
      cellTopic: 'c',
      items,
      generateImpl: async () => '[{"n":1,"fit":true},{"n":2,"fit":false}]',
    });
    expect(out[1]).toEqual({ videoId: 'bbb', fit: false });
    expect(out[0]).toEqual({ videoId: 'aaa', fit: true });
  });
  test('의견 분열 (한 leg만 unfit) → fit 유지 (오침전 방지, 2026-07-13 반려견)', async () => {
    const out = await judgeCellCards({
      centerGoal: 'g',
      cellTopic: 'c',
      items,
      generateImpl: async (model: string) =>
        model.includes('gemini')
          ? '[{"n":1,"fit":true},{"n":2,"fit":false}]'
          : '[{"n":1,"fit":true},{"n":2,"fit":true}]',
    });
    expect(out[1]).toEqual({ videoId: 'bbb', fit: true });
  });
  test('한 leg 실패 + 다른 leg unfit → fit 유지 (실패 leg는 침전 차단)', async () => {
    const out = await judgeCellCards({
      centerGoal: 'g',
      cellTopic: 'c',
      items,
      generateImpl: async (model: string) => {
        if (model.includes('gemini')) throw new Error('down');
        return '[{"n":1,"fit":false},{"n":2,"fit":false}]';
      },
    });
    expect(out.every((v) => v.fit)).toBe(true);
  });
});
