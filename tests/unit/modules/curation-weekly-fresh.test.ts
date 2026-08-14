import {
  curationSubGoals,
  curationPoolAdmission,
} from '../../../src/modules/curation/weekly-fresh';

describe('curationSubGoals (design §6 derived sub-queries)', () => {
  it('derives 3-5 cell labels anchored on the topic', () => {
    const goals = curationSubGoals('  파이썬  ');
    expect(goals.length).toBeGreaterThanOrEqual(3);
    expect(goals.length).toBeLessThanOrEqual(5);
    expect(goals[0]).toBe('파이썬');
    for (const g of goals) expect(g).toContain('파이썬');
  });
});

describe('curationPoolAdmission (no view floor — fresh uploads must land)', () => {
  const base = { title: '주간 신규 영상', durationSec: 600, viewCount: 42 };

  it('admits a low-view fresh upload (classifyQuality would reject it)', () => {
    const v = curationPoolAdmission(base);
    expect(v.admit).toBe(true);
    expect(v.tier).toBe('bronze');
  });

  it('still rejects shorts-length and marathon-length videos', () => {
    expect(curationPoolAdmission({ ...base, durationSec: 30 }).admit).toBe(false);
    expect(curationPoolAdmission({ ...base, durationSec: 30 }).reason).toBe('too_short');
    expect(curationPoolAdmission({ ...base, durationSec: 4000 }).admit).toBe(false);
    expect(curationPoolAdmission({ ...base, durationSec: null }).admit).toBe(false);
  });

  it('tiers by views for diagnostics without gating admission', () => {
    expect(curationPoolAdmission({ ...base, viewCount: 150_000 }).tier).toBe('gold');
    expect(curationPoolAdmission({ ...base, viewCount: 20_000 }).tier).toBe('silver');
    expect(curationPoolAdmission({ ...base, viewCount: null }).tier).toBe('bronze');
  });
});
