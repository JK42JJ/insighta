import {
  isSubgoalAnchorEnabled,
  extractDomainAnchor,
  buildAnchoredSubgoalQuery,
} from '@/config/subgoal-anchor';

describe('subgoal-anchor (T9)', () => {
  it('flag defaults off (legacy raw subgoal)', () => {
    expect(isSubgoalAnchorEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(
      isSubgoalAnchorEnabled({ DISCOVER_SUBGOAL_ANCHOR_ENABLED: 'true' } as NodeJS.ProcessEnv)
    ).toBe(true);
  });

  it('strips durations and goal-action words', () => {
    expect(extractDomainAnchor('일본어 JLPT N3 6개월 합격')).toBe('일본어 JLPT N3');
    expect(extractDomainAnchor('마라톤 풀코스 4시간 완주')).toBe('마라톤 풀코스');
    expect(extractDomainAnchor('퇴근 후 1시간으로 유튜브 채널 키우기')).toBe('퇴근 후 유튜브 채널');
    expect(extractDomainAnchor('자취생 기본 요리 마스터')).toBe('자취생 기본 요리');
  });

  it('caps anchor length at 4 tokens', () => {
    expect(
      extractDomainAnchor('아주 매우 정말 몹시 대단히 긴 목표').split(' ').length
    ).toBeLessThanOrEqual(4);
  });

  it('builds "<anchor> <subgoal>" and falls back to raw subgoal', () => {
    expect(buildAnchoredSubgoalQuery('일본어 JLPT N3 6개월 합격', '청취 회화')).toBe(
      '일본어 JLPT N3 청취 회화'
    );
    expect(buildAnchoredSubgoalQuery('4시간 완주', '레이스 준비')).toBe('레이스 준비');
  });

  it('drops anchor tokens already present in the subgoal (no stutter)', () => {
    expect(buildAnchoredSubgoalQuery('마라톤 풀코스 4시간 완주', '마라톤 페이스 훈련')).toBe(
      '풀코스 마라톤 페이스 훈련'
    );
  });
});
