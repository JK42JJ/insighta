/**
 * domain-fit-shadow/shadow — R13-1 enforce-0 invariant tests, R14-1 rescope.
 *
 * Pins:
 *   - flag off (enabled:false) → zero classifyDomainFit calls, zero recordTrace
 *     calls (byte-identical to pre-R13 behavior).
 *   - empty candidate list → no-op even when enabled.
 *   - enforce-0: the input candidate array is never mutated or reordered.
 *   - candidates beyond maxCandidates are not scored (load cap).
 *   - recordTrace is called with the expected step name + shape (fit/not_fit/
 *     failed counts + per-candidate rank/cellIndex preserved).
 *   - runDomainFitShadow never throws even when classifyDomainFit rejects.
 *   - R14-1: classification is ALWAYS against centerGoal (goal-level), never
 *     subGoals[cellIndex] — cellIndex is still logged, just not used to pick
 *     the comparison text.
 *   - R14-1: scalar capture is additive, off by default, never replaces the
 *     binary call.
 */

const mockClassify = jest.fn();
const mockClassifyScalar = jest.fn();
const mockRecordTrace = jest.fn();

jest.mock('@/modules/domain-fit-shadow/client', () => ({
  classifyDomainFit: (...args: unknown[]) => mockClassify(...args),
  classifyDomainFitScalar: (...args: unknown[]) => mockClassifyScalar(...args),
}));
jest.mock('@/modules/discover-tracing', () => ({
  recordTrace: (...args: unknown[]) => mockRecordTrace(...args),
}));

import {
  scheduleDomainFitShadow,
  runDomainFitShadow,
  type ScheduleDomainFitShadowInput,
} from '@/modules/domain-fit-shadow/shadow';
import type { DomainFitShadowConfig } from '@/config/domain-fit-shadow';

const CFG: DomainFitShadowConfig = {
  enabled: true,
  ollamaUrl: 'http://100.91.173.17:11434',
  model: 'mandala-gen:latest',
  timeoutMs: 5000,
  concurrency: 2,
  maxCandidates: 3,
  scalarEnabled: false,
  writeShadowEnabled: false, // R19 — unrelated to this read-path suite
  writeEnforceEnabled: false, // R23 — unrelated to this read-path suite
  serveShadowEnabled: false, // R23 — unrelated to this read-path suite
  serveEnforceEnabled: false, // R24 — unrelated to this read-path suite
};

function baseInput(n: number): ScheduleDomainFitShadowInput {
  return {
    stage: 'tier2',
    centerGoal: '영어 프리토킹 달성',
    subGoals: ['발음', '문법', '어휘'],
    candidates: Array.from({ length: n }, (_, i) => ({
      videoId: `v${i}`,
      title: `title ${i}`,
      cellIndex: i % 3,
      rank: i,
      score: 1 - i * 0.01,
    })),
  };
}

beforeEach(() => {
  mockClassify.mockReset();
  mockClassifyScalar.mockReset();
  mockRecordTrace.mockReset();
  mockClassify.mockResolvedValue({ fit: '적합', ms: 5, ok: true });
  mockClassifyScalar.mockResolvedValue({ fit: '적합', score: 0.9, ms: 5, ok: true });
});

describe('scheduleDomainFitShadow — flag gating', () => {
  it('is a no-op when the flag is off (zero classify calls, zero trace writes)', () => {
    scheduleDomainFitShadow(baseInput(5), { ...CFG, enabled: false });
    expect(mockClassify).not.toHaveBeenCalled();
    expect(mockRecordTrace).not.toHaveBeenCalled();
  });

  it('is a no-op on an empty candidate list even when enabled', () => {
    scheduleDomainFitShadow({ ...baseInput(0) }, CFG);
    expect(mockClassify).not.toHaveBeenCalled();
    expect(mockRecordTrace).not.toHaveBeenCalled();
  });
});

describe('runDomainFitShadow — enforce-0 + logging shape', () => {
  it('never mutates or reorders the caller candidate array', async () => {
    const input = baseInput(5);
    const snapshot = JSON.stringify(input.candidates);
    await runDomainFitShadow(input, CFG);
    expect(JSON.stringify(input.candidates)).toBe(snapshot);
  });

  it('caps scoring at maxCandidates (load guard)', async () => {
    const input = baseInput(10); // maxCandidates=3 in CFG
    await runDomainFitShadow(input, CFG);
    expect(mockClassify).toHaveBeenCalledTimes(3);
  });

  it('scores every candidate when under the cap', async () => {
    const input = baseInput(2);
    await runDomainFitShadow(input, CFG);
    expect(mockClassify).toHaveBeenCalledTimes(2);
  });

  it('R14-1: always classifies against centerGoal, regardless of cellIndex (goal-level, not per-cell)', async () => {
    const input = baseInput(1);
    input.candidates[0]!.cellIndex = 1; // subGoals[1] = '문법' — must NOT be used
    await runDomainFitShadow(input, CFG);
    expect(mockClassify).toHaveBeenCalledWith('영어 프리토킹 달성', 'title 0', CFG);
  });

  it('R14-1: still uses centerGoal even when cellIndex is out of subGoals range', async () => {
    const input = baseInput(1);
    input.candidates[0]!.cellIndex = 99;
    await runDomainFitShadow(input, CFG);
    expect(mockClassify).toHaveBeenCalledWith('영어 프리토킹 달성', 'title 0', CFG);
  });

  it('R14-1: does not call classifyDomainFitScalar when scalarEnabled is false (default)', async () => {
    const input = baseInput(2);
    await runDomainFitShadow(input, CFG);
    expect(mockClassifyScalar).not.toHaveBeenCalled();
  });

  it('R14-1: calls classifyDomainFitScalar per candidate when scalarEnabled is true, additive not substitutive', async () => {
    const input = baseInput(2);
    await runDomainFitShadow(input, { ...CFG, scalarEnabled: true });
    expect(mockClassify).toHaveBeenCalledTimes(2);
    expect(mockClassifyScalar).toHaveBeenCalledTimes(2);
    expect(mockClassifyScalar).toHaveBeenCalledWith('영어 프리토킹 달성', 'title 0', {
      ...CFG,
      scalarEnabled: true,
    });
  });

  it('R14-1: logs scalarScore per candidate + scalar_mean in the trace response when scalarEnabled', async () => {
    mockClassifyScalar
      .mockResolvedValueOnce({ fit: '적합', score: 0.9, ms: 5, ok: true })
      .mockResolvedValueOnce({ fit: '적합', score: 0.7, ms: 5, ok: true });
    const input = baseInput(2);
    await runDomainFitShadow(input, { ...CFG, scalarEnabled: true });
    const call = mockRecordTrace.mock.calls[0]![0];
    expect(call.response.scalar_mean).toBeCloseTo(0.8);
    expect(call.response.candidates[0].scalarScore).toBe(0.9);
    expect(call.response.candidates[1].scalarScore).toBe(0.7);
  });

  it('R14-1: trace request payload marks goal_level:true and scalar_enabled', async () => {
    const input = baseInput(1);
    await runDomainFitShadow(input, CFG);
    const call = mockRecordTrace.mock.calls[0]![0];
    expect(call.request.goal_level).toBe(true);
    expect(call.request.scalar_enabled).toBe(false);
  });

  it('writes one recordTrace call with step domain_fit_shadow.<stage> and count/candidate shape', async () => {
    mockClassify
      .mockResolvedValueOnce({ fit: '적합', ms: 5, ok: true })
      .mockResolvedValueOnce({ fit: '비적합', ms: 5, ok: true })
      .mockResolvedValueOnce({ fit: null, ms: 5, ok: false });
    const input = baseInput(3);
    await runDomainFitShadow(input, CFG);

    expect(mockRecordTrace).toHaveBeenCalledTimes(1);
    const call = mockRecordTrace.mock.calls[0]![0];
    expect(call.step).toBe('domain_fit_shadow.tier2');
    expect(call.status).toBe('ok');
    expect(call.response.fit).toBe(1);
    expect(call.response.not_fit).toBe(1);
    expect(call.response.failed).toBe(1);
    expect(call.response.candidates).toHaveLength(3);
    expect(call.response.candidates[0]).toMatchObject({
      videoId: 'v0',
      cellIndex: 0,
      rank: 0,
      fit: '적합',
    });
  });

  it('never throws even when classifyDomainFit rejects unexpectedly', async () => {
    mockClassify.mockRejectedValue(new Error('boom'));
    const input = baseInput(2);
    await expect(runDomainFitShadow(input, CFG)).resolves.toBeUndefined();
    // Rejection is swallowed before recordTrace — no observability write on a
    // hard internal failure (never a crash, but also never a false log).
    expect(mockRecordTrace).not.toHaveBeenCalled();
  });
});
