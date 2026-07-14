/**
 * T11 Stage1 — flag gate + cell-floor plan semantics (supervisor ①:
 * keep ≥ minPerCell per cell, drop only the excess unfit; kept-despite-unfit
 * marked for the tone-down path).
 */
import {
  isT11InflowJudgeEnabled,
  planCellFloor,
  type CellVerdictInput,
} from '@/config/t11-inflow-judge';

const card = (videoId: string, cellIndex: number, fit: boolean): CellVerdictInput => ({
  videoId,
  cellIndex,
  fit,
});

describe('T11 inflow judge', () => {
  it('flag defaults off', () => {
    expect(isT11InflowJudgeEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(isT11InflowJudgeEnabled({ T11_INFLOW_JUDGE_ENABLED: 'true' } as NodeJS.ProcessEnv)).toBe(
      true
    );
  });

  it('drops unfit only above the floor (개의 심리 case: 10 cards, 7 unfit, floor 3)', () => {
    const cards = [
      ...[1, 2, 3].map((i) => card(`fit${i}`, 1, true)),
      ...[1, 2, 3, 4, 5, 6, 7].map((i) => card(`bad${i}`, 1, false)),
    ];
    const plan = planCellFloor(cards, 3);
    // 3 fit already meet the floor → all 7 unfit droppable.
    expect(plan.wouldDrop).toHaveLength(7);
    expect(plan.keptDespiteUnfit).toHaveLength(0);
  });

  it('keeps unfit to honor the floor when fit cards are scarce (1 fit, 4 unfit, floor 3)', () => {
    const cards = [card('fit1', 2, true), ...[1, 2, 3, 4].map((i) => card(`bad${i}`, 2, false))];
    const plan = planCellFloor(cards, 3);
    expect(plan.keptDespiteUnfit).toHaveLength(2); // 1 fit + 2 kept = floor 3
    expect(plan.wouldDrop).toHaveLength(2);
  });

  it('all-unfit thin cell keeps everything up to the floor (2 unfit, floor 3 → drop 0)', () => {
    const cards = [card('bad1', 3, false), card('bad2', 3, false)];
    const plan = planCellFloor(cards, 3);
    expect(plan.wouldDrop).toHaveLength(0);
    expect(plan.keptDespiteUnfit).toHaveLength(2);
  });

  it('cells are independent', () => {
    const cards = [
      card('a1', 0, false),
      card('a2', 0, true),
      ...[1, 2, 3, 4].map((i) => card(`b${i}`, 1, true)),
      card('b5', 1, false),
    ];
    const plan = planCellFloor(cards, 1);
    expect(plan.wouldDrop.sort()).toEqual(['a1', 'b5']);
    expect(plan.keptDespiteUnfit).toHaveLength(0);
  });
});
