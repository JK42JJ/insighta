/**
 * CP498 PR3a — computeCardRelevance: pure A-stage relevance scorer.
 *
 * Pins the PR3a guarantees: (1) no DB write (pure — no prisma import to mock),
 * (2) youtube_videos-independent (title/desc are arguments), (3) transcript-
 * optional (works with transcript omitted → title+desc fallback), (4) a single
 * Haiku call (no Sonnet). The score is whatever the LLM returns; we mock fetch.
 */

const mockConfig = {
  openrouter: { apiKey: 'test-key', model: 'anthropic/claude-haiku-4.5' },
};
jest.mock('@/config/index', () => ({ config: mockConfig }));
jest.mock('@/modules/llm/call-logger', () => ({ logLLMCall: jest.fn(() => Promise.resolve()) }));

import { computeCardRelevance } from '@/modules/relevance/compute-card-relevance';

const haikuJson = (pct: number) =>
  JSON.stringify({
    core: { one_liner: '기초 체력' },
    analysis: {
      core_argument: '기초 체력은 모든 운동의 토대다.',
      mandala_fit: { mandala_relevance_pct: pct },
    },
  });

const okResponse = (content: string): Response =>
  ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }], usage: {} }),
  }) as unknown as Response;

afterEach(() => jest.restoreAllMocks());

describe('computeCardRelevance (CP498 PR3a)', () => {
  it('returns the Haiku relevance score from card title+description (no transcript)', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(okResponse(haikuJson(82))) as unknown as typeof fetch;

    const out = await computeCardRelevance({
      title: '기초 체력 기르기',
      description: '맨몸 운동 루틴',
      centerGoal: '운동 습관 만들기',
      // transcript intentionally omitted — title+desc fallback
    });

    expect(out).toEqual({ ok: true, relevancePct: 82 });
    expect(global.fetch).toHaveBeenCalledTimes(1); // single Haiku call, no Sonnet
  });

  it('uses transcript when provided (still one call)', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(okResponse(haikuJson(40))) as unknown as typeof fetch;
    const out = await computeCardRelevance({
      title: 'Deep work explained',
      centerGoal: 'focus habits',
      transcript: 'In this video we discuss focus and deep work...',
    });
    expect(out).toEqual({ ok: true, relevancePct: 40 });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects empty title without calling the LLM', async () => {
    global.fetch = jest.fn() as unknown as typeof fetch;
    const out = await computeCardRelevance({ title: '   ', centerGoal: 'x' });
    expect(out).toEqual({ ok: false, reason: 'no_title' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('strips a ```json fence before parsing', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        okResponse('```json\n' + haikuJson(55) + '\n```')
      ) as unknown as typeof fetch;
    const out = await computeCardRelevance({ title: 'T', centerGoal: 'g' });
    expect(out).toEqual({ ok: true, relevancePct: 55 });
  });

  // CP499 — cellGoal: SSOT cell-aware scoring + back-compat (v2-path-identical).
  it('cellGoal present → prompt carries BOTH center goal and cell goal + criterion', async () => {
    const fetchMock = jest.fn().mockResolvedValue(okResponse(haikuJson(70)));
    global.fetch = fetchMock as unknown as typeof fetch;

    await computeCardRelevance({
      title: '집중력 높이는 법',
      centerGoal: '목표 달성',
      cellGoal: '집중 환경 만들기',
    });

    const body = (fetchMock.mock.calls[0][1] as RequestInit).body as string;
    expect(body).toContain('목표 달성'); // centerGoal
    expect(body).toContain('집중 환경 만들기'); // cellGoal
    expect(body).toContain('이 카드가 배치될 셀'); // cell label injected
    expect(body).toContain('셀에 적합하면서 중심 목표에 기여'); // explicit criterion
  });

  it('cellGoal absent → goal is centerGoal VERBATIM (no cell label) = v2-path-identical', async () => {
    const fetchMock = jest.fn().mockResolvedValue(okResponse(haikuJson(60)));
    global.fetch = fetchMock as unknown as typeof fetch;

    await computeCardRelevance({ title: 'T', centerGoal: '운동 습관 만들기' });

    const body = (fetchMock.mock.calls[0][1] as RequestInit).body as string;
    // verbatim single-line goal — byte-identical to the pre-CP499 string the
    // shared buildV2QuickPrompt received (so the v2 Heart path is unchanged).
    expect(body).toContain('MANDALA CENTER GOAL: 운동 습관 만들기');
    expect(body).not.toContain('이 카드가 배치될 셀'); // no cell injection
    expect(body).not.toContain('셀에 적합하면서'); // no criterion line
  });
});
