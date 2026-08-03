import {
  CURATION_FRESHNESS_LADDER_DAYS,
  curationFreshnessCutoffs,
} from '../../../src/modules/curation/config';
import { MS_PER_DAY } from '../../../src/utils/time-constants';

describe('curationFreshnessCutoffs (weekly-novelty ladder, 2026-08-03)', () => {
  const weekStart = new Date('2026-08-03T00:00:00Z');

  it('yields one cutoff per ladder rung plus a final unbounded rung', () => {
    const cutoffs = curationFreshnessCutoffs(weekStart);
    expect(cutoffs).toHaveLength(CURATION_FRESHNESS_LADDER_DAYS.length + 1);
    expect(cutoffs[cutoffs.length - 1]).toBeUndefined();
  });

  it('anchors each rung N days before the week start', () => {
    const cutoffs = curationFreshnessCutoffs(weekStart);
    CURATION_FRESHNESS_LADDER_DAYS.forEach((days, i) => {
      expect(cutoffs[i]!.getTime()).toBe(weekStart.getTime() - days * MS_PER_DAY);
    });
  });

  it('widens monotonically — every rung reaches further back than the last', () => {
    const cutoffs = curationFreshnessCutoffs(weekStart);
    for (let i = 1; i < CURATION_FRESHNESS_LADDER_DAYS.length; i++) {
      expect(cutoffs[i]!.getTime()).toBeLessThan(cutoffs[i - 1]!.getTime());
    }
  });
});
