/**
 * domain-fit-shadow/write-gate — R23 WRITE-edge ENFORCE-capable gate.
 *
 * Pins:
 *   - composite score = (T3 fit ? 1 : 0) * lexical multiplier; threshold 0.5.
 *   - '적합' + no lexical conflict → passed.
 *   - '적합' + lexical conflict (R22 pattern) → BLOCKED even though T3 said fit.
 *   - '비적합' → blocked regardless of lexical signal.
 *   - classifier failure/timeout (ok:false or fit:null) → FAIL-OPEN (passed:true).
 *   - runDomainFitWriteEnforce logs exactly one recordTrace call, step
 *     domain_fit_write_enforce.<stage>, and the returned decision is never
 *     altered by a trace-logging failure.
 */

const mockClassify = jest.fn();
const mockRecordTrace = jest.fn();
const mockWithTraceContext = jest.fn();
const mockGetTraceContext = jest.fn();

jest.mock('@/modules/domain-fit-shadow/client', () => {
  const actual = jest.requireActual('@/modules/domain-fit-shadow/client');
  return {
    ...actual,
    classifyDomainFit: (...args: unknown[]) => mockClassify(...args),
  };
});
jest.mock('@/modules/discover-tracing', () => ({
  recordTrace: (...args: unknown[]) => mockRecordTrace(...args),
  getTraceContext: (...args: unknown[]) => mockGetTraceContext(...args),
  withTraceContext: (ctx: unknown, fn: () => Promise<unknown>) => mockWithTraceContext(ctx, fn),
}));

import {
  evaluateDomainFitWriteGate,
  runDomainFitWriteEnforce,
  DOMAIN_FIT_WRITE_ENFORCE_THRESHOLD,
} from '@/modules/domain-fit-shadow/write-gate';
import type { DomainFitShadowConfig } from '@/config/domain-fit-shadow';

const CFG: DomainFitShadowConfig = {
  enabled: false,
  ollamaUrl: 'http://100.91.173.17:11434',
  model: 'mandala-gen:latest',
  timeoutMs: 5000,
  concurrency: 4,
  maxCandidates: 40,
  scalarEnabled: false,
  writeShadowEnabled: false,
  writeEnforceEnabled: true,
  serveShadowEnabled: false,
  serveEnforceEnabled: false,
  syncConsumeEnabled: false,
};

beforeEach(() => {
  mockClassify.mockReset();
  mockRecordTrace.mockReset();
  mockWithTraceContext.mockReset();
  mockGetTraceContext.mockReset();
  mockGetTraceContext.mockReturnValue({ mandalaId: 'm1', userId: 'u1', runId: 'r1' });
  mockWithTraceContext.mockImplementation((_ctx: unknown, fn: () => Promise<unknown>) => fn());
});

describe('DOMAIN_FIT_WRITE_ENFORCE_THRESHOLD', () => {
  it('is 0.5 (named constant, no magic number at call sites)', () => {
    expect(DOMAIN_FIT_WRITE_ENFORCE_THRESHOLD).toBe(0.5);
  });
});

describe('evaluateDomainFitWriteGate — composite T3 + lexical decision', () => {
  it('적합 + no lexical conflict → passed, score 1', async () => {
    mockClassify.mockResolvedValue({ fit: '적합', ms: 5, ok: true });
    const r = await evaluateDomainFitWriteGate(
      '100일 영어 회화 완성하기',
      '영어 발음 교정 Day1',
      CFG
    );
    expect(r.passed).toBe(true);
    expect(r.fit).toBe('적합');
    expect(r.score).toBe(1);
    expect(r.lexicalConflict).toBe(false);
    expect(r.reason).toBe('fit');
  });

  it('적합 BUT a lexical qualifier conflict (R22 pattern) → BLOCKED despite T3 fit', async () => {
    mockClassify.mockResolvedValue({ fit: '적합', ms: 5, ok: true });
    const r = await evaluateDomainFitWriteGate(
      '100일 영어 회화 완성하기',
      '실전 일본여행회화 3강 일본어',
      CFG
    );
    expect(r.lexicalConflict).toBe(true);
    expect(r.score).toBeCloseTo(0.2);
    expect(r.passed).toBe(false);
    expect(r.reason).toBe('lexical_conflict');
  });

  it('비적합 → blocked regardless of lexical signal', async () => {
    mockClassify.mockResolvedValue({ fit: '비적합', ms: 5, ok: true });
    const r = await evaluateDomainFitWriteGate('영어 회화', '전혀 무관한 제목', CFG);
    expect(r.score).toBe(0);
    expect(r.passed).toBe(false);
    expect(r.reason).toBe('not_fit');
  });

  it('classifier failure (ok:false) → FAIL-OPEN (passed:true), never blocks on infra outage', async () => {
    mockClassify.mockResolvedValue({ fit: null, ms: 5000, ok: false, error: 'timeout' });
    const r = await evaluateDomainFitWriteGate('영어 회화', '아무 제목', CFG);
    expect(r.passed).toBe(true);
    expect(r.classifierOk).toBe(false);
    expect(r.score).toBeNull();
    expect(r.reason).toBe('classifier_unavailable_fail_open');
  });

  it('classifyDomainFit rejecting unexpectedly never throws (classifyDomainFit itself never throws — this is a defensive pin)', async () => {
    mockClassify.mockResolvedValue({ fit: null, ms: 5, ok: false });
    await expect(evaluateDomainFitWriteGate('영어 회화', '아무 제목', CFG)).resolves.toMatchObject({
      passed: true,
    });
  });
});

describe('runDomainFitWriteEnforce — logging shape', () => {
  it('logs exactly one recordTrace call, step domain_fit_write_enforce.<stage>', async () => {
    mockClassify.mockResolvedValue({ fit: '적합', ms: 5, ok: true });
    const result = await runDomainFitWriteEnforce(
      {
        stage: 'reuse',
        centerGoal: '영어 회화',
        videoId: 'vid12345678',
        title: '영어 발음 교정',
        source: 'user_live',
      },
      CFG
    );
    expect(result.passed).toBe(true);
    expect(mockRecordTrace).toHaveBeenCalledTimes(1);
    const call = mockRecordTrace.mock.calls[0]![0];
    expect(call.step).toBe('domain_fit_write_enforce.reuse');
    expect(call.request.video_id).toBe('vid12345678');
    expect(call.response.decision).toBe('passed');
  });

  it('logs decision:blocked on a block verdict', async () => {
    mockClassify.mockResolvedValue({ fit: '비적합', ms: 5, ok: true });
    const result = await runDomainFitWriteEnforce(
      {
        stage: 'reuse',
        centerGoal: '영어 회화',
        videoId: 'vid12345678',
        title: '전혀 무관',
        source: 'user_live',
      },
      CFG
    );
    expect(result.passed).toBe(false);
    const call = mockRecordTrace.mock.calls[0]![0];
    expect(call.response.decision).toBe('blocked');
    expect(call.response.reason).toBe('not_fit');
  });

  it('creates a scoped trace context when none is bound (mirrors write-shadow.ts)', async () => {
    mockGetTraceContext.mockReturnValue(null);
    mockClassify.mockResolvedValue({ fit: '적합', ms: 5, ok: true });
    await runDomainFitWriteEnforce(
      {
        stage: 'reuse',
        centerGoal: '영어 회화',
        videoId: 'vid12345678',
        title: '영어 발음 교정',
        source: 'user_live',
        mandalaId: 'm-abc',
        userId: 'u-xyz',
      },
      CFG
    );
    expect(mockWithTraceContext).toHaveBeenCalledTimes(1);
    expect(mockWithTraceContext.mock.calls[0]![0]).toEqual({ mandalaId: 'm-abc', userId: 'u-xyz' });
  });

  it('a trace-logging failure never alters the returned decision', async () => {
    mockClassify.mockResolvedValue({ fit: '적합', ms: 5, ok: true });
    mockRecordTrace.mockImplementation(() => {
      throw new Error('trace boom');
    });
    const result = await runDomainFitWriteEnforce(
      {
        stage: 'reuse',
        centerGoal: '영어 회화',
        videoId: 'vid12345678',
        title: '영어 발음 교정',
        source: 'user_live',
      },
      CFG
    );
    expect(result.passed).toBe(true);
  });
});
