/**
 * domain-fit-shadow/lexical-qualifier — non-LLM qualifier-conflict deboost
 * (R22-1). Pins: conflict detection, absence-is-no-op, category matching
 * accuracy, multiplier constant.
 */
import {
  extractQualifierValues,
  detectQualifierConflicts,
  applyQualifierDeboost,
  DEFAULT_QUALIFIER_CONFLICT_MULTIPLIER,
} from '@/modules/domain-fit-shadow/lexical-qualifier';

describe('extractQualifierValues', () => {
  it('finds a language token in Korean text', () => {
    expect(extractQualifierValues('100일 영어 회화 완성하기', 'language')).toEqual(new Set(['en']));
  });
  it('finds multiple language tokens (comparison title)', () => {
    expect(extractQualifierValues('일본어 vs 중국어 비교', 'language')).toEqual(
      new Set(['ja', 'zh'])
    );
  });
  it('returns empty set when no vocab hit', () => {
    expect(extractQualifierValues('전화 영업 회화 스크립트', 'language').size).toBe(0);
  });
  it('is case-insensitive for Latin cloud-vendor tokens', () => {
    expect(extractQualifierValues('AWS IaC 툴로 컨테이너 개발하기', 'cloud_vendor')).toEqual(
      new Set(['aws'])
    );
    expect(extractQualifierValues('azure 아키텍트 되기', 'cloud_vendor')).toEqual(
      new Set(['azure'])
    );
  });
  it('normalizes cloud-vendor synonyms to the same canonical id', () => {
    expect(extractQualifierValues('구글클라우드 강의', 'cloud_vendor')).toEqual(new Set(['gcp']));
    expect(extractQualifierValues('GCP 자격증', 'cloud_vendor')).toEqual(new Set(['gcp']));
  });
  it('finds an instrument token', () => {
    expect(extractQualifierValues('클래식기타 독학', 'instrument')).toEqual(new Set(['guitar']));
  });
});

describe('detectQualifierConflicts — CONFLICT', () => {
  it('flags a language conflict (영어 goal vs 일본어 title, R20-CONVO-JA-01)', () => {
    const r = detectQualifierConflicts(
      '100일 영어 회화 완성하기',
      '편의점에서 무조건 쓰게되는 쉬운 일본어  -【실전 일본여행회화 3강】'
    );
    expect(r.hasConflict).toBe(true);
    expect(r.multiplier).toBe(DEFAULT_QUALIFIER_CONFLICT_MULTIPLIER);
    expect(r.conflicts).toEqual([
      { category: 'language', goalValues: ['en'], titleValues: ['ja'] },
    ]);
  });

  it('flags a cloud-vendor conflict (KT goal vs Oracle title, R20-1 R014)', () => {
    const r = detectQualifierConflicts(
      'KT 클라우드 강의안 작성',
      '고객 서비스 클라우드 탄생 배경 [TalkIT, 오라클 클라우드]'
    );
    expect(r.hasConflict).toBe(true);
    expect(r.conflicts[0]?.category).toBe('cloud_vendor');
    expect(r.conflicts[0]?.goalValues).toEqual(['kt']);
    expect(r.conflicts[0]?.titleValues).toEqual(['oracle']);
  });

  it('flags an instrument conflict (piano goal vs guitar title)', () => {
    const r = detectQualifierConflicts(
      '성인 피아노 입문하여 1년 내 쇼팽 녹턴 1곡 완성',
      '클래식기타 - 독학으로 배울 수 있는가?'
    );
    expect(r.hasConflict).toBe(true);
    expect(r.conflicts[0]?.category).toBe('instrument');
  });
});

describe('detectQualifierConflicts — ABSENCE never deboosts', () => {
  it('no-ops when the title has zero vocab hits in a category the goal names (Azure goal, no vendor named in title)', () => {
    const r = detectQualifierConflicts(
      '일주일 내 Azure 아키텍트 되기',
      'IAM Interview Questions - Identity & Access Management Complete Guide for Cybersecurity Jobs'
    );
    expect(r.hasConflict).toBe(false);
    expect(r.multiplier).toBe(1);
  });
  it('no-ops when the goal has zero vocab hits (piano goal, no instrument word at all in either text)', () => {
    const r = detectQualifierConflicts(
      '독학으로 피아노 중급 달성 후 유튜브 연주 채널 구독자 500명 확보',
      '클로드 코드 사용법 | 주요 기능 13분만에 마스터하기!'
    );
    expect(r.hasConflict).toBe(false);
  });
  it('no-ops on a same-value match (both name English) — not a conflict', () => {
    const r = detectQualifierConflicts('100일 영어 회화 완성하기', '영어 발음 교정 Day1');
    expect(r.hasConflict).toBe(false);
    expect(r.multiplier).toBe(1);
  });
});

describe('detectQualifierConflicts — legit niche protection (R16 niche_legit sample)', () => {
  it('does not deboost a legit same-instrument variant title (통기타 vs 클래식기타, both instrument=guitar)', () => {
    const r = detectQualifierConflicts(
      'Learn Classical Guitar and Perform 3 Complete Pieces From Memory at a Recital in 18 Months',
      '누구나 100% 다 할 수 있는 신개념 기타 지판 5분 만에 외우는 법/통기타 강좌 7080'
    );
    expect(r.hasConflict).toBe(false);
  });
});

describe('applyQualifierDeboost', () => {
  it('multiplies the score down on conflict', () => {
    expect(
      applyQualifierDeboost(1, '100일 영어 회화 완성하기', '실전 일본여행회화 3강 일본어')
    ).toBeCloseTo(DEFAULT_QUALIFIER_CONFLICT_MULTIPLIER);
  });
  it('leaves the score unchanged on absence/no-conflict', () => {
    expect(applyQualifierDeboost(0.8, '영어 회화', '영어 발음 교정')).toBe(0.8);
  });
});
