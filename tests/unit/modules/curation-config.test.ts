import { CURATION_PICK_RUNGS, curationPickPlan } from '../../../src/modules/curation/config';
import { MS_PER_DAY } from '../../../src/utils/time-constants';

describe('curationPickPlan (weekly pick ladder + empty-week floor, 2026-08-03)', () => {
  const weekStart = new Date('2026-08-03T00:00:00Z');
  const plan = curationPickPlan(weekStart);

  it('yields one step per rung', () => {
    expect(plan).toHaveLength(CURATION_PICK_RUNGS.length);
  });

  it('resolves freshness cutoffs N days before the week start, unbounded rungs omit it', () => {
    CURATION_PICK_RUNGS.forEach((rung, i) => {
      if (rung.freshDays != null) {
        expect(plan[i]!.publishedAfter!.getTime()).toBe(
          weekStart.getTime() - rung.freshDays * MS_PER_DAY
        );
      } else {
        expect(plan[i]!.publishedAfter).toBeUndefined();
      }
    });
  });

  it('loosens monotonically — thresholds never rise, exclusion horizons never widen', () => {
    for (let i = 1; i < plan.length; i++) {
      expect(plan[i]!.threshold).toBeLessThanOrEqual(plan[i - 1]!.threshold);
      const prev = plan[i - 1]!.exclusionAfter?.getTime() ?? -Infinity;
      const cur = plan[i]!.exclusionAfter?.getTime() ?? -Infinity;
      expect(cur).toBeGreaterThanOrEqual(prev);
    }
  });

  it('final rungs shrink the exclusion horizon so a niche topic cannot drain to zero', () => {
    const last = plan[plan.length - 1]!;
    expect(last.exclusionAfter).toBeDefined();
    expect(last.exclusionAfter!.getTime()).toBe(weekStart.getTime() - 4 * 7 * MS_PER_DAY);
    expect(last.threshold).toBeLessThan(0.5);
  });
});
