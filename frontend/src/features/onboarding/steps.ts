/**
 * Coachmark step declarations per moment.
 *
 * `anchor` is a CSS selector resolved at show-time; a missing anchor skips
 * that step (never blocks the tour). Copy lives in i18n under onboarding.*.
 */
export interface CoachStep {
  id: string;
  /** CSS selector for the spotlight target. */
  anchor: string;
  titleKey: string;
  titleDefault: string;
  bodyKey: string;
  bodyDefault: string;
}

export const DASHBOARD_STEPS: CoachStep[] = [
  {
    id: 'dash.sectors.v1',
    anchor: '[data-onboarding="sectors"]',
    titleKey: 'onboarding.dash.sectors.title',
    titleDefault: '목표가 8개 실행영역으로 분해됐어요',
    bodyKey: 'onboarding.dash.sectors.body',
    bodyDefault: '칩을 누르면 영역별 영상만 모아볼 수 있어요.',
  },
  {
    id: 'dash.cards.v1',
    anchor: '[data-onboarding="cards"] > :first-child',
    titleKey: 'onboarding.dash.cards.title',
    titleDefault: 'AI가 목표 관련도로 엄선한 영상 카드',
    bodyKey: 'onboarding.dash.cards.body',
    bodyDefault: "'핵심' 배지가 붙은 카드부터 보는 걸 추천해요.",
  },
  {
    id: 'dash.addcards.v1',
    anchor: '[data-onboarding="add-cards"]',
    titleKey: 'onboarding.dash.addcards.title',
    titleDefault: '부족한 영역은 직접 채우기',
    bodyKey: 'onboarding.dash.addcards.body',
    bodyDefault: '키워드·조회수·길이 필터로 원하는 영상을 더 찾을 수 있어요.',
  },
  {
    id: 'dash.search.v1',
    anchor: '[data-onboarding="search"]',
    titleKey: 'onboarding.dash.search.title',
    titleDefault: '⌘K — 무엇이든 즉시 검색',
    bodyKey: 'onboarding.dash.search.body',
    bodyDefault: '카드, 만다라, 노트, AI 요약을 한 번에 찾아요.',
  },
];

export const LEARNING_STEPS: CoachStep[] = [
  {
    id: 'learn.summary.v1',
    anchor: '[data-onboarding="ai-summary"]',
    titleKey: 'onboarding.learn.summary.title',
    titleDefault: '구간별 AI 요약',
    bodyDefault: '타임스탬프를 클릭하면 그 장면으로 바로 점프해요. %는 목표 관련도예요.',
    bodyKey: 'onboarding.learn.summary.body',
  },
  {
    id: 'learn.panel.v1',
    anchor: '[data-onboarding="learn-panel"]',
    titleKey: 'onboarding.learn.panel.title',
    titleDefault: '메모와 AI 챗봇',
    bodyKey: 'onboarding.learn.panel.body',
    bodyDefault:
      '보면서 메모를 남기고, 궁금한 건 영상에 대해 바로 질문하세요. 퀴즈로 확인도 가능해요.',
  },
];
