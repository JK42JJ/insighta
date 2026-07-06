/**
 * domain-fit-shadow/write-shadow — R19 WRITE-edge shadow enforce-0 invariants.
 *
 * Pins:
 *   - flag off (writeShadowEnabled:false) → zero classifyDomainFit calls,
 *     zero recordTrace calls (byte-identical to pre-R19 behavior).
 *   - flag on → exactly one classifyDomainFit call + one recordTrace call,
 *     step name domain_fit_shadow.write.<stage>.
 *   - the write decision itself is never touched: scheduleDomainFitWriteShadow
 *     returns void, no return value a caller could branch a write on.
 *   - runDomainFitWriteShadow never throws even when classifyDomainFit rejects.
 *   - when no ambient trace context is bound, a scoped one is created so the
 *     shadow write is never silently dropped (mirrors reuse-from-v5.ts /
 *     cards.ts call sites which may run outside `withTraceContext`).
 *   - when an ambient trace context IS already bound (e.g. add-cards.ts's
 *     wrap around the v5 executor), the existing context is reused, not
 *     re-wrapped.
 */

const mockClassify = jest.fn();
const mockRecordTrace = jest.fn();
const mockWithTraceContext = jest.fn();
const mockGetTraceContext = jest.fn();

jest.mock('@/modules/domain-fit-shadow/client', () => ({
  classifyDomainFit: (...args: unknown[]) => mockClassify(...args),
}));
jest.mock('@/modules/discover-tracing', () => ({
  recordTrace: (...args: unknown[]) => mockRecordTrace(...args),
  getTraceContext: (...args: unknown[]) => mockGetTraceContext(...args),
  withTraceContext: (ctx: unknown, fn: () => Promise<unknown>) => mockWithTraceContext(ctx, fn),
}));

import {
  scheduleDomainFitWriteShadow,
  runDomainFitWriteShadow,
  type ScheduleDomainFitWriteShadowInput,
} from '@/modules/domain-fit-shadow/write-shadow';
import type { DomainFitShadowConfig } from '@/config/domain-fit-shadow';

const CFG_OFF: DomainFitShadowConfig = {
  enabled: false,
  ollamaUrl: 'http://100.91.173.17:11434',
  model: 'mandala-gen:latest',
  timeoutMs: 5000,
  concurrency: 4,
  maxCandidates: 40,
  scalarEnabled: false,
  writeShadowEnabled: false,
  writeEnforceEnabled: false,
  serveShadowEnabled: false,
  serveEnforceEnabled: false,
};
const CFG_ON: DomainFitShadowConfig = { ...CFG_OFF, writeShadowEnabled: true };

function baseInput(stage: 'reuse' | 'like' = 'reuse'): ScheduleDomainFitWriteShadowInput {
  return {
    stage,
    centerGoal: '6개월 내 영어 프리토킹 달성',
    videoId: 'vid12345678',
    title: '영어 회화 꿀팁 10가지',
    source: stage === 'reuse' ? 'user_live' : 'user_curated',
  };
}

beforeEach(() => {
  mockClassify.mockReset();
  mockRecordTrace.mockReset();
  mockWithTraceContext.mockReset();
  mockGetTraceContext.mockReset();
  mockClassify.mockResolvedValue({ fit: '적합', ms: 5, ok: true });
  mockGetTraceContext.mockReturnValue({ mandalaId: 'm1', userId: 'u1', runId: 'r1' });
  mockWithTraceContext.mockImplementation((_ctx: unknown, fn: () => Promise<unknown>) => fn());
});

describe('scheduleDomainFitWriteShadow — flag gating (enforce-0)', () => {
  it('is a no-op when writeShadowEnabled is off — zero classify calls, zero trace writes', () => {
    scheduleDomainFitWriteShadow(baseInput(), CFG_OFF);
    expect(mockClassify).not.toHaveBeenCalled();
    expect(mockRecordTrace).not.toHaveBeenCalled();
  });

  it('returns void — no value a caller could branch a write decision on', () => {
    const ret = scheduleDomainFitWriteShadow(baseInput(), CFG_ON);
    expect(ret).toBeUndefined();
  });
});

describe('runDomainFitWriteShadow — logging shape + async safety', () => {
  it('writes exactly one recordTrace call with step domain_fit_shadow.write.<stage>', async () => {
    const input = baseInput('reuse');
    await runDomainFitWriteShadow(input, CFG_ON);
    expect(mockClassify).toHaveBeenCalledTimes(1);
    expect(mockClassify).toHaveBeenCalledWith(input.centerGoal, input.title, CFG_ON);
    expect(mockRecordTrace).toHaveBeenCalledTimes(1);
    const call = mockRecordTrace.mock.calls[0]![0];
    expect(call.step).toBe('domain_fit_shadow.write.reuse');
    expect(call.status).toBe('ok');
    expect(call.request.video_id).toBe('vid12345678');
    expect(call.request.source).toBe('user_live');
    expect(call.response.fit).toBe('적합');
    expect(call.response.ok).toBe(true);
  });

  it('uses the "like" stage step name for the /like call site', async () => {
    await runDomainFitWriteShadow(baseInput('like'), CFG_ON);
    const call = mockRecordTrace.mock.calls[0]![0];
    expect(call.step).toBe('domain_fit_shadow.write.like');
    expect(call.request.source).toBe('user_curated');
  });

  it('reuses an existing ambient trace context (does not re-wrap)', async () => {
    mockGetTraceContext.mockReturnValue({ mandalaId: 'm1', userId: 'u1', runId: 'r1' });
    await runDomainFitWriteShadow(baseInput(), CFG_ON);
    expect(mockWithTraceContext).not.toHaveBeenCalled();
    expect(mockRecordTrace).toHaveBeenCalledTimes(1);
  });

  it('creates a scoped trace context when none is bound (never silently drops the write-log)', async () => {
    mockGetTraceContext.mockReturnValue(null);
    const input = { ...baseInput(), mandalaId: 'm-abc', userId: 'u-xyz' };
    await runDomainFitWriteShadow(input, CFG_ON);
    expect(mockWithTraceContext).toHaveBeenCalledTimes(1);
    expect(mockWithTraceContext.mock.calls[0]![0]).toEqual({
      mandalaId: 'm-abc',
      userId: 'u-xyz',
    });
    expect(mockRecordTrace).toHaveBeenCalledTimes(1);
  });

  it('never throws even when classifyDomainFit rejects unexpectedly', async () => {
    mockClassify.mockRejectedValue(new Error('boom'));
    await expect(runDomainFitWriteShadow(baseInput(), CFG_ON)).resolves.toBeUndefined();
    expect(mockRecordTrace).not.toHaveBeenCalled();
  });
});
