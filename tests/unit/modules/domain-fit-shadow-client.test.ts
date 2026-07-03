/**
 * domain-fit-shadow/client — frozen T3 prompt + parse + Ollama call tests.
 *
 * Pins:
 *   - buildT3Prompt byte-identical to docs/qa/domain-fit-probe-T3.md (frozen).
 *   - parseFit clean-JSON path + fragile-fallback substring path.
 *   - classifyDomainFit never throws (http error / network throw / timeout
 *     all resolve to { fit: null, ok: false }).
 *   - R14-1: buildT3ScalarPrompt / parseFitScalar / classifyDomainFitScalar
 *     (additive scalar-capture variant, frozen "R12 scalar-capture variant").
 */
import {
  buildT3Prompt,
  buildT3ScalarPrompt,
  parseFit,
  parseFitScalar,
  classifyDomainFit,
  classifyDomainFitScalar,
} from '@/modules/domain-fit-shadow/client';

const CFG = {
  ollamaUrl: 'http://100.91.173.17:11434',
  model: 'mandala-gen:latest',
  timeoutMs: 5000,
};

describe('buildT3Prompt — frozen spec', () => {
  it('matches the frozen T3 template verbatim (docs/qa/domain-fit-probe-T3.md)', () => {
    const prompt = buildT3Prompt('영어 프리토킹 달성', '발음 교정 Day1');
    expect(prompt).toBe(
      '### Instruction:\n다음 영상 제목과 목표의 주제 적합성을 분류하라 (적합/비적합). JSON만 출력: {"fit": "적합"|"비적합"}\n\n### Input:\n영상 제목: 발음 교정 Day1\n관련 목표: 영어 프리토킹 달성\n\n### Output:\n'
    );
  });
});

describe('parseFit', () => {
  it('parses clean JSON fit=적합', () => {
    expect(parseFit('{"fit": "적합"}')).toEqual({ parsed: '적합', ok: true });
  });
  it('parses clean JSON fit=비적합', () => {
    expect(parseFit('{"fit": "비적합"}')).toEqual({ parsed: '비적합', ok: true });
  });
  it('rejects an unrecognized fit value inside otherwise-valid JSON', () => {
    expect(parseFit('{"fit": "maybe"}')).toEqual({ parsed: null, ok: false });
  });
  it('falls back to substring scan for malformed JSON (fragile, ok=false)', () => {
    expect(parseFit('의 fit 은 비적합 입니다')).toEqual({ parsed: '비적합', ok: false });
  });
  it('falls back to substring scan for fit-only text', () => {
    expect(parseFit('결과: "적합" 맞습니다')).toEqual({ parsed: '적합', ok: false });
  });
  it('returns null when neither label appears anywhere', () => {
    expect(parseFit('모르겠습니다')).toEqual({ parsed: null, ok: false });
  });
});

describe('classifyDomainFit — never throws', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('resolves ok:true on a clean JSON response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ response: '{"fit": "적합"}' }),
    }) as unknown as typeof fetch;
    const r = await classifyDomainFit('goal', 'title', CFG);
    expect(r).toMatchObject({ fit: '적합', ok: true });
  });

  it('resolves ok:false on HTTP error status (never throws)', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'boom',
    }) as unknown as typeof fetch;
    const r = await classifyDomainFit('goal', 'title', CFG);
    expect(r.ok).toBe(false);
    expect(r.fit).toBeNull();
    expect(r.error).toContain('500');
  });

  it('resolves ok:false on a network throw (never throws)', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;
    const r = await classifyDomainFit('goal', 'title', CFG);
    expect(r.ok).toBe(false);
    expect(r.fit).toBeNull();
    expect(r.error).toContain('ECONNREFUSED');
  });

  it('calls the raw /api/generate endpoint with the frozen call shape', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ response: '{"fit": "적합"}' }),
    });
    global.fetch = mockFetch as unknown as typeof fetch;
    await classifyDomainFit('goal', 'title', CFG);
    expect(mockFetch).toHaveBeenCalledWith(
      `${CFG.ollamaUrl}/api/generate`,
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"raw":true'),
      })
    );
    const body = JSON.parse((mockFetch.mock.calls[0]?.[1] as { body: string }).body);
    expect(body).toMatchObject({
      model: CFG.model,
      raw: true,
      stream: false,
      options: { temperature: 0.1, num_predict: 60 },
    });
  });
});

describe('buildT3ScalarPrompt — frozen R12 scalar-capture spec', () => {
  it('matches the frozen T3_SCALAR template verbatim (docs/qa/domain-fit-probe-T3.md)', () => {
    const prompt = buildT3ScalarPrompt('영어 프리토킹 달성', '발음 교정 Day1');
    expect(prompt).toBe(
      '### Instruction:\n다음 영상 제목과 목표의 주제 적합성을 분류하라 (적합/비적합). 그리고 0.0~1.0 사이의 적합도 confidence 점수도 함께 산정하라 (1.0=완전히 같은 주제, 0.0=전혀 무관). JSON만 출력: {"fit": "적합"|"비적합", "score": 0.0~1.0}\n\n### Input:\n영상 제목: 발음 교정 Day1\n관련 목표: 영어 프리토킹 달성\n\n### Output:\n'
    );
  });
});

describe('parseFitScalar', () => {
  it('parses clean JSON fit + score', () => {
    expect(parseFitScalar('{"fit": "적합", "score": 0.85}')).toEqual({
      parsed: '적합',
      score: 0.85,
      ok: true,
    });
  });
  it('parses clean JSON fit with score missing (null)', () => {
    expect(parseFitScalar('{"fit": "비적합"}')).toEqual({
      parsed: '비적합',
      score: null,
      ok: true,
    });
  });
  it('ignores a non-numeric score field', () => {
    expect(parseFitScalar('{"fit": "적합", "score": "high"}')).toEqual({
      parsed: '적합',
      score: null,
      ok: true,
    });
  });
  it('falls back to the binary fragile-fallback (score always null) for malformed JSON', () => {
    expect(parseFitScalar('의 fit 은 비적합 입니다')).toEqual({
      parsed: '비적합',
      score: null,
      ok: false,
    });
  });
});

describe('classifyDomainFitScalar — never throws', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('resolves fit + score on a clean JSON response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ response: '{"fit": "적합", "score": 0.92}' }),
    }) as unknown as typeof fetch;
    const r = await classifyDomainFitScalar('goal', 'title', CFG);
    expect(r).toMatchObject({ fit: '적합', score: 0.92, ok: true });
  });

  it('resolves ok:false + score:null on HTTP error (never throws)', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'boom',
    }) as unknown as typeof fetch;
    const r = await classifyDomainFitScalar('goal', 'title', CFG);
    expect(r).toMatchObject({ fit: null, score: null, ok: false });
  });

  it('resolves ok:false + score:null on a network throw (never throws)', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;
    const r = await classifyDomainFitScalar('goal', 'title', CFG);
    expect(r).toMatchObject({ fit: null, score: null, ok: false });
    expect(r.error).toContain('ECONNREFUSED');
  });

  it('uses the T3_SCALAR prompt (distinct from the binary T3 call)', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ response: '{"fit": "적합", "score": 0.5}' }),
    });
    global.fetch = mockFetch as unknown as typeof fetch;
    await classifyDomainFitScalar('goal', 'title', CFG);
    const body = JSON.parse((mockFetch.mock.calls[0]?.[1] as { body: string }).body);
    expect(body.prompt).toContain('confidence 점수도 함께 산정하라');
  });
});
