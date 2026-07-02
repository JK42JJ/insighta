/**
 * Coachmark step declarations.
 *
 * `anchor` is a CSS selector resolved at show-time; a missing anchor is
 * polled (~8s) then skipped. Copy lives in i18n under onboarding.*.
 */
import type { OnboardingTask } from './model/onboardingStore';

export interface CoachStep {
  id: string;
  /** CSS selector for the spotlight target. */
  anchor: string;
  titleKey: string;
  titleDefault: string;
  bodyKey: string;
  bodyDefault: string;
}

/** Auto tour — fires ONCE right after the user's first mandala lands. */
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
    bodyDefault: "카드를 클릭하면 영상과 AI 요약이 열려요. '핵심' 배지부터 보세요.",
  },
  {
    id: 'dash.guide.v1',
    anchor: '[data-onboarding="guide-chip"]',
    titleKey: 'onboarding.dash.guide.title',
    titleDefault: '시작 가이드',
    bodyKey: 'onboarding.dash.guide.body',
    bodyDefault: '남은 첫걸음을 여기서 확인하세요. 모두 마치면 자동으로 사라져요.',
  },
];

/** Checklist rows — each task knows how to guide the user when clicked. */
export interface TaskGuide {
  task: OnboardingTask;
  labelKey: string;
  labelDefault: string;
  /** Where guidance can be shown; '/' = dashboard. null = no navigation. */
  route: string | null;
  /** Single coach step fired on click (anchor must exist on `route`). */
  step: CoachStep;
}

export const TASK_GUIDES: TaskGuide[] = [
  {
    task: 'wizard',
    labelKey: 'onboarding.tasks.wizard',
    labelDefault: '목표로 만다라 만들기',
    route: '/mandalas/new',
    step: {
      id: 'task.wizard.v1',
      anchor: '[data-onboarding="wizard-goal"]',
      titleKey: 'onboarding.task.wizard.title',
      titleDefault: '목표를 입력해 보세요',
      bodyKey: 'onboarding.task.wizard.body',
      bodyDefault: '목표를 쓰면 8개 실행영역과 영상 커리큘럼이 만들어져요.',
    },
  },
  {
    task: 'watch',
    labelKey: 'onboarding.tasks.watch',
    labelDefault: '카드 열어 영상 보기',
    route: '/',
    step: {
      id: 'task.watch.v1',
      anchor: '[data-onboarding="cards"] > :first-child',
      titleKey: 'onboarding.task.watch.title',
      titleDefault: '카드를 클릭해 보세요',
      bodyKey: 'onboarding.task.watch.body',
      bodyDefault: '영상 러닝 화면이 열리고, 구간별 AI 요약이 함께 나와요.',
    },
  },
  {
    task: 'summary',
    labelKey: 'onboarding.tasks.summary',
    labelDefault: 'AI 요약으로 핵심 파악',
    route: null,
    step: {
      id: 'task.summary.v1',
      anchor: '[data-onboarding="ai-summary"]',
      titleKey: 'onboarding.task.summary.title',
      titleDefault: '구간별 AI 요약',
      bodyKey: 'onboarding.task.summary.body',
      bodyDefault: '타임스탬프를 클릭하면 그 장면으로 바로 점프해요. %는 목표 관련도예요.',
    },
  },
  {
    task: 'note',
    labelKey: 'onboarding.tasks.note',
    labelDefault: '노트 확인하고 메모 남기기',
    route: null,
    step: {
      id: 'task.note.v1',
      anchor: '[data-onboarding="learn-panel"]',
      titleKey: 'onboarding.task.note.title',
      titleDefault: '메모와 노트',
      bodyKey: 'onboarding.task.note.body',
      bodyDefault: '보면서 메모를 남기고, 상단 [노트] 토글로 노트 뷰를 열 수 있어요.',
    },
  },
  {
    task: 'addcards',
    labelKey: 'onboarding.tasks.addcards',
    labelDefault: '부족한 카드 직접 추가',
    route: '/',
    step: {
      id: 'task.addcards.v1',
      anchor: '[data-onboarding="add-cards"]',
      titleKey: 'onboarding.task.addcards.title',
      titleDefault: '카드 더 찾기',
      bodyKey: 'onboarding.task.addcards.body',
      bodyDefault: '키워드·조회수·길이 필터로 원하는 영상을 더 찾을 수 있어요. ⌘K 검색도 있어요.',
    },
  },
];

/** Fallback when a task's anchor lives on a screen we can't navigate to
 *  (learning needs a videoId) — point at the card grid instead. */
export const LEARNING_FALLBACK_STEP: CoachStep = {
  id: 'task.learn-fallback.v1',
  anchor: '[data-onboarding="cards"] > :first-child',
  titleKey: 'onboarding.task.learnFallback.title',
  titleDefault: '먼저 카드를 열어 보세요',
  bodyKey: 'onboarding.task.learnFallback.body',
  bodyDefault: '카드를 클릭하면 영상 화면에서 AI 요약과 노트를 볼 수 있어요.',
};
