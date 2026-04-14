/**
 * Prompt #2: Actions generation (background, ~10-15s).
 *
 * Generates 8 actions per sub_goal (64 total).
 * Called fire-and-forget after mandala creation.
 *
 * @see docs/design/wizard-redesign-v2.md Phase 2
 */

export const ACTIONS_MODEL = 'anthropic/claude-haiku-4.5';
export const ACTIONS_TEMPERATURE = 0.7;
export const ACTIONS_MAX_TOKENS = 2500;

export interface ActionsPromptInput {
  centerGoal: string;
  subGoals: string[];
  language: string;
  focusTags?: string[];
  targetLevel?: string;
}

export function buildActionsPrompt(input: ActionsPromptInput): string {
  const { centerGoal, subGoals, language, focusTags, targetLevel } = input;
  const level = targetLevel ?? 'standard';
  const subList = subGoals.map((g, i) => `  ${i}. ${g}`).join('\n');

  if (language === 'ko') {
    const koFocusLine = focusTags?.length ? `- 집중 영역: ${focusTags.join(', ')}\n` : '';
    return `만다라트 차트의 각 하위 목표에 대해 8개의 구체적이고 측정 가능한 실행 단계를 생성.

만다라 컨텍스트:
- 중심 목표: ${centerGoal}
- 하위 목표:
${subList}
${koFocusLine}- 목표 수준: ${level} (foundation=기초/standard=중급/advanced=심화)

규칙:
- 각 action은 구체적이고, 측정 가능하고, 달성 가능해야 함
- 목표 수준에 맞게 action 난이도 조절:
  - foundation: 기초적, 단계별, 진입 장벽 낮음
  - standard: 스킬 빌딩, 실전 중심
  - advanced: 최적화, 마스터리, 타인 교육
- sub_goal당 정확히 8개, 총 64개
- sub_goals와 동일한 언어로 작성

JSON만 출력:
{"0":["8개 실행 단계"],"1":["8개"],...,"7":["8개"]}`;
  }

  const focusLine = focusTags?.length ? `- Focus areas: ${focusTags.join(', ')}\n` : '';
  return `Generate 8 concrete action items for each sub_goal of a mandala chart.

MANDALA CONTEXT:
- Center goal: ${centerGoal}
- Sub-goals:
${subList}
${focusLine}- Target level: ${level} (foundation/standard/advanced)

RULES:
- Each action must be specific, measurable, and achievable
- Actions should help the user REACH the target level:
  - foundation: foundational, step-by-step, low barrier
  - standard: skill-building, practice-oriented
  - advanced: optimization, mastery, teaching others
- Exactly 8 actions per sub_goal, 64 total
- Actions in the same language as sub_goals

OUTPUT: JSON only.
{"0":["8 actions"],"1":["8 actions"],...,"7":["8 actions"]}`;
}
