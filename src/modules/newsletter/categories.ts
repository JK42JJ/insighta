/**
 * The ten briefs, and what to call them.
 *
 * Declared once. The list was copied into `admin/newsletter.ts` and
 * `admin/trusted-channels.ts`, and a third copy was about to be written for
 * the subscription API — at which point a category added in one place would
 * be rejected by the other two, and the failure would read as a validation
 * error rather than as three lists disagreeing.
 *
 * Labels live here too because a reader picking a subscription sees them, and
 * a key rendered raw ("news-trend") is not a name anyone chose.
 *
 * Source: the master spec §23. `dev` and `ai-tech` are separate on purpose —
 * one is the change in AI itself, the other is general programming.
 */

export interface BriefCategory {
  key: string;
  label: string;
  /** One line, shown where a reader decides whether to subscribe. */
  blurb: string;
}

export const BRIEF_CATEGORIES: readonly BriefCategory[] = [
  {
    key: 'ai-tech',
    label: 'AI 엔지니어링',
    blurb: '모델·에이전트·추론·보안. 실무자가 만든 것에서만.',
  },
  { key: 'dev', label: '개발', blurb: '언어·프레임워크·아키텍처. AI 자체는 AI 엔지니어링으로.' },
  { key: 'career', label: '커리어', blurb: '이직·면접·직무 전환. 채용 공고가 아니라 겪은 이야기.' },
  { key: 'english', label: '영어', blurb: '실전 영어. 시험 대비가 아니라 쓰는 영어.' },
  { key: 'investing', label: '투자', blurb: '시장·자산·기업 분석. 종목 추천은 다루지 않는다.' },
  { key: 'shopping', label: '소비', blurb: '살 것과 사지 않을 것. 광고와 구분해서.' },
  {
    key: 'productivity',
    label: '생산성',
    blurb: '도구와 습관. 유행하는 앱 소개가 아니라 남는 방법.',
  },
  { key: 'health', label: '건강', blurb: '운동·식사·수면. 근거가 있는 것만.' },
  { key: 'startup', label: '스타트업', blurb: '창업과 운영. 성공담보다 무엇이 깨졌는지.' },
  { key: 'news-trend', label: '뉴스·트렌드', blurb: '그 주에 실제로 달라진 것.' },
] as const;

export const CATEGORY_KEYS: ReadonlySet<string> = new Set(BRIEF_CATEGORIES.map((c) => c.key));

export function categoryLabel(key: string): string {
  return BRIEF_CATEGORIES.find((c) => c.key === key)?.label ?? key;
}
