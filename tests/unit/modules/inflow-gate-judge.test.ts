/**
 * inflow-gate judge — wizard relevance judge partition tests (CP500++ PR-3).
 *
 * Pins the gate semantics:
 *   - pass (gatePct ≥ relevanceMin)        → kept
 *   - below min                            → wouldCut (NOT kept)
 *   - boundary (gatePct === relevanceMin)  → kept (≥)
 *   - scorer failure                       → FAIL-OPEN (kept, failedOpen++)
 *   - rubric ON                            → gate axis = goal_contribution_pct
 *   - title-only (description null)        → scorer called with description=''
 *
 * computeCardRelevance + loadRelevanceRubricConfig are mocked at module load.
 */

const mockCompute = jest.fn();
const mockRubricCfg = jest.fn();

jest.mock('@/modules/relevance/compute-card-relevance', () => ({
  computeCardRelevance: (...args: unknown[]) => mockCompute(...args),
}));
jest.mock('@/config/relevance-rubric', () => ({
  loadRelevanceRubricConfig: () => mockRubricCfg(),
}));

import { judgeWizardSlots, type JudgeSlot } from '@/modules/inflow-gate/judge';
import type { InflowGateConfig } from '@/config/inflow-gate';

const CFG: InflowGateConfig = { enabled: true, cut: true, relevanceMin: 60 };

const slot = (
  videoId: string,
  title: string,
  cellIndex = 0,
  description: string | null = null
): JudgeSlot => ({
  videoId,
  title,
  description,
  cellIndex,
});

const ctx = (over: Partial<Parameters<typeof judgeWizardSlots>[1]> = {}) => ({
  centerGoal: 'become a better SaaS founder',
  subGoals: ['pricing', 'growth', 'hiring'],
  language: 'en' as const,
  cfg: CFG,
  ...over,
});

beforeEach(() => {
  mockCompute.mockReset();
  mockRubricCfg.mockReset();
  mockRubricCfg.mockReturnValue({ enabled: false, prune: false, pruneGcMin: 65 });
});

describe('judgeWizardSlots — partition', () => {
  it('keeps all slots that score ≥ relevanceMin', async () => {
    mockCompute.mockResolvedValue({ ok: true, relevancePct: 80 });
    const res = await judgeWizardSlots([slot('a', 'A'), slot('b', 'B')], ctx());
    expect(res.kept.map((s) => s.videoId)).toEqual(['a', 'b']);
    expect(res.wouldCut).toHaveLength(0);
    expect(res.scored).toBe(2);
    expect(res.failedOpen).toBe(0);
  });

  it('would-cuts slots below min, keeps the rest', async () => {
    mockCompute
      .mockResolvedValueOnce({ ok: true, relevancePct: 80 }) // a pass
      .mockResolvedValueOnce({ ok: true, relevancePct: 30 }); // b cut
    const res = await judgeWizardSlots([slot('a', 'A'), slot('b', 'B')], ctx());
    expect(res.kept.map((s) => s.videoId)).toEqual(['a']);
    expect(res.wouldCut).toHaveLength(1);
    expect(res.wouldCut[0]).toMatchObject({ videoId: 'b', gatePct: 30 });
    expect(res.wouldCut[0]!.reason).toContain('below_min');
  });

  it('treats gatePct === relevanceMin as PASS (≥)', async () => {
    mockCompute.mockResolvedValue({ ok: true, relevancePct: 60 });
    const res = await judgeWizardSlots([slot('a', 'A')], ctx());
    expect(res.kept).toHaveLength(1);
    expect(res.wouldCut).toHaveLength(0);
  });
});

describe('judgeWizardSlots — fail-open', () => {
  it('keeps a slot when the scorer returns ok:false (no cut on failure)', async () => {
    mockCompute.mockResolvedValue({ ok: false, reason: 'provider_error: 500' });
    const res = await judgeWizardSlots([slot('a', 'A'), slot('b', 'B')], ctx());
    expect(res.kept.map((s) => s.videoId)).toEqual(['a', 'b']);
    expect(res.wouldCut).toHaveLength(0);
    expect(res.failedOpen).toBe(2);
  });

  it('mixes fail-open and real cuts correctly', async () => {
    mockCompute
      .mockResolvedValueOnce({ ok: false, reason: 'json_parse' }) // a fail-open → kept
      .mockResolvedValueOnce({ ok: true, relevancePct: 10 }); // b real cut
    const res = await judgeWizardSlots([slot('a', 'A'), slot('b', 'B')], ctx());
    expect(res.kept.map((s) => s.videoId)).toEqual(['a']);
    expect(res.wouldCut.map((w) => w.videoId)).toEqual(['b']);
    expect(res.failedOpen).toBe(1);
  });
});

describe('judgeWizardSlots — rubric axis + inputs', () => {
  it('rubric ON → gate axis = goal_contribution_pct (not composite)', async () => {
    mockRubricCfg.mockReturnValue({ enabled: true, prune: false, pruneGcMin: 65 });
    // composite high (would pass) but goal_contribution low (must cut)
    mockCompute.mockResolvedValue({
      ok: true,
      relevancePct: 90,
      detail: { cellFitPct: 90, goalContributionPct: 20, actionabilityPct: 80 },
    });
    const res = await judgeWizardSlots([slot('a', 'A')], ctx());
    expect(res.kept).toHaveLength(0);
    expect(res.wouldCut[0]).toMatchObject({ videoId: 'a', gatePct: 20 });
    // rubric:true forwarded to scorer
    expect(mockCompute).toHaveBeenCalledWith(expect.objectContaining({ rubric: true }));
  });

  it('passes title-only (description null → empty string) + cellGoal from subGoals[cellIndex]', async () => {
    mockCompute.mockResolvedValue({ ok: true, relevancePct: 75 });
    await judgeWizardSlots([slot('a', 'A', 1, null)], ctx());
    expect(mockCompute).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'A',
        description: '',
        centerGoal: 'become a better SaaS founder',
        cellGoal: 'growth',
      })
    );
  });
});
