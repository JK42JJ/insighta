/**
 * Prompt #1: Mandala structure generation (Step 1, user-facing, ~3s).
 *
 * Generates center_goal + 8 sub_goals + labels. No actions.
 * center_goal is overridden by code after LLM response (hard rule).
 *
 * @see docs/design/wizard-redesign-v2.md Phase 2
 */

export const STRUCTURE_MODEL = 'anthropic/claude-haiku-4.5';
export const STRUCTURE_TEMPERATURE = 0.7;
export const STRUCTURE_MAX_TOKENS = 500;

export interface StructurePromptInput {
  goal: string;
  domain: string;
  language: string;
  focusTags?: string[];
  targetLevel?: string;
  /** Optional few-shot reference from pgvector search */
  reference?: string;
}

export function buildStructurePrompt(input: StructurePromptInput): string {
  const { goal, domain, language, focusTags, targetLevel, reference } = input;
  const level = targetLevel ?? 'standard';
  const focusLine = focusTags?.length ? `- Focus areas: ${focusTags.join(', ')}` : '';
  const example = reference ? `${reference}\n` : '';

  if (language === 'ko') {
    const koFocusLine = focusTags?.length ? `- 집중 영역: ${focusTags.join(', ')}` : '';
    return `만다라트 구조 생성 (actions 없이 구조만).

규칙:
- center_goal: 사용자가 입력한 목표를 그대로 사용. 절대 재작성/확장/축약하지 말 것.
- center_label: center_goal의 2-4단어 요약 (최대 10자)
- sub_goals: 8개 구체적 영역
  - 구체적이고 실행 가능한 영역이어야 함
  - 목표 수준(${level})에 맞게 설계
${koFocusLine ? '  - ' + koFocusLine.slice(2) + '을 자연스럽게 반영\n' : ''}- sub_labels: 각 sub_goal의 의미를 담은 짧은 라벨
  - 4-10자가 의미를 전달하면 짧게
  - 의미 전달이 안 되면 길게 사용 가능
  - 무의미한 축약 금지, 앞글자 자르기 금지

${example}JSON만 출력:
{"center_goal":"...","center_label":"...","language":"ko","domain":"${domain}","sub_goals":["8개"],"sub_labels":["8개"]}

목표: ${goal}`;
  }

  return `Generate mandala structure (NO actions).

RULES:
- center_goal: Use the user's goal EXACTLY as given. NEVER rewrite, expand, or shorten it.
- center_label: 2-4 word summary (max 15 chars)
- sub_goals: 8 distinct areas that TOGETHER achieve the center goal
  - Must be specific and actionable
  - Design sub_goals to REACH the target level (${level})
${focusLine ? '  - Incorporate focus areas naturally: ' + (focusTags ?? []).join(', ') + '\n' : ''}- sub_labels: Short meaningful label for each sub_goal
  - If 4-15 chars convey meaning clearly, keep it short
  - Only use longer labels when meaning cannot be expressed briefly
  - NEVER meaningless abbreviation (DecltrM, AttentTrn)
  - NEVER camelCase compound (InnerPeaceFoundation → "Inner Peace")

${example}JSON only:
{"center_goal":"...","center_label":"...","language":"en","domain":"${domain}","sub_goals":["8 items"],"sub_labels":["8 items"]}

Goal: ${goal}`;
}
