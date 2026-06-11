/**
 * Prompt #1-merged: Mandala structure + per-cell YouTube search queries in ONE
 * continuous-context Haiku call (CP493).
 *
 * Combines the structure rules of buildStructurePrompt (structure-generator.ts)
 * with the searchable per-cell query rules of buildPerCellSearchQueryPrompt
 * (search-query-generator.ts). The model generates each sub_goal AND its search
 * query in the same pass, so the query inherits the goal-structure reasoning
 * instead of re-interpreting a bare label downstream (the two-call split that
 * produced near-duplicate clustering noise).
 *
 * Output (single JSON):
 *   { center_goal, center_label, language, domain,
 *     sub_goals[8], sub_labels[8], cell_queries:{"0":..,"7":..} }
 *
 * Same model/temp as structure-gen; max tokens raised for the extra queries.
 *
 * @see src/config/wizard-merged-gen.ts (WIZARD_MERGED_GEN flag)
 */

export const MERGED_GEN_MODEL = 'anthropic/claude-haiku-4.5';
export const MERGED_GEN_TEMPERATURE = 0.7;
/**
 * Structure (~520) + 8 search queries (~80) + cell_queries JSON keys (~30) ≈
 * 630 tokens. 1000 gives headroom so neither sub_labels nor cell_queries is
 * silently truncated (the 500→700 truncation lesson from structure-gen).
 */
export const MERGED_GEN_MAX_TOKENS = 1000;

export interface MergedGenPromptInput {
  goal: string;
  domain: string;
  language: string;
  focusTags?: string[];
  targetLevel?: string;
  /** Optional few-shot reference from pgvector search (structure only). */
  reference?: string;
}

export function buildMandalaWithQueriesPrompt(input: MergedGenPromptInput): string {
  const { goal, domain, language, focusTags, targetLevel, reference } = input;
  const level = targetLevel ?? 'standard';
  const example = reference ? `${reference}\n` : '';

  if (language === 'ko') {
    const koFocusLine = focusTags?.length ? `- 집중 영역: ${focusTags.join(', ')}` : '';
    return `만다라트 구조 + 각 영역의 YouTube 검색어를 한 번에 생성합니다 (actions 없이).

[1단계 — 구조]
- center_goal: 사용자가 입력한 목표를 그대로 사용. 절대 재작성/확장/축약하지 말 것.
- center_label: center_goal의 2-4단어 요약 (최대 10자). 단어 사이 공백 (예: "미국 주식 1억" ✅).
- sub_goals: 함께 모이면 목표를 달성하는 8개의 구체적이고 실행 가능한 영역. 목표 수준(${level})에 맞게 설계.
${koFocusLine ? '  - ' + koFocusLine.slice(2) + '을 자연스럽게 반영\n' : ''}- sub_labels: 각 sub_goal의 의미를 담은 짧은 라벨 (4-10자, 무의미한 축약/앞글자 자르기 금지, 단어 사이 공백).

[2단계 — 검색어] 각 sub_goal마다, 그 영역을 다루는 영상을 찾을 실제 YouTube 검색어 1개.
- 각 검색어 12~20자. {목표 핵심어 1~2개} + {세부영역 핵심어 1~2개} 결합. 의미가 살아있는 검색가능한 표현.
- 너무 짧으면(예: "시간 관리", "보험") 일반 콘텐츠로 확산 → 금지.
- 너무 길거나 문장형(예: "매일 학습할 수 있는 시간 블록 설정하는 방법")이면 YouTube 매칭 실패 → 금지.
- 8개 검색어는 서로 다른 각도(방법론/경험담/도구/실수방지/루틴 등)로 분산 — 같은 표현 반복 금지 (한 셀이 동일 브랜드/채널로 뭉치는 노이즈 방지).

[3단계 — 도메인 휘발성] volatility: 이 목표의 콘텐츠가 시간이 지나면 낡는가? 기술/도구/트렌드(예: AI 도구, 코딩, 투자 트렌드)면 "volatile", 시간 무관(예: 운동, 요가, 어학, 마음수련)이면 "evergreen". 한 단어만.

${example}JSON만 출력 (cell_queries 키는 sub_goals 순서 "0"~"7"):
{"center_goal":"...","center_label":"...","language":"ko","domain":"${domain}","volatility":"volatile|evergreen","sub_goals":["8개"],"sub_labels":["8개"],"cell_queries":{"0":"검색어",...,"7":"검색어"}}

목표: ${goal}`;
  }

  const focusLine = focusTags?.length ? `- Focus areas: ${focusTags.join(', ')}` : '';
  return `Generate the mandala structure AND a YouTube search query per area in ONE pass (NO actions).

[Step 1 — structure]
- center_goal: Use the user's goal EXACTLY as given. NEVER rewrite, expand, or shorten it.
- center_label: 2-4 word summary (max 15 chars).
- sub_goals: 8 distinct, specific, actionable areas that TOGETHER achieve the center goal. Design to REACH the target level (${level}).
${focusLine ? '  - Incorporate focus areas naturally: ' + (focusTags ?? []).join(', ') + '\n' : ''}- sub_labels: short meaningful label per sub_goal (4-15 chars; NEVER meaningless abbreviation / camelCase compound).

[Step 2 — queries] For each sub_goal, ONE real YouTube search query that finds videos covering that area.
- Each query 3-6 words. {goal keyword 1-2} + {area keyword 1-2}. A real, searchable phrase.
- Too short (e.g. "time management") → generic content → forbidden.
- Too long / sentence-like → no YouTube match → forbidden.
- Spread the 8 queries across different angles (how-to / stories / tools / mistakes / routine) — never repeat a phrase (prevents a cell clustering on one brand/channel).

[Step 3 — domain volatility] volatility: does content for this goal go stale over time? Tech/tools/trends (AI tools, coding, investing trends) = "volatile"; timeless (fitness, yoga, language learning, mindfulness) = "evergreen". One word only.

${example}JSON only (cell_queries keys are sub_goals order "0".."7"):
{"center_goal":"...","center_label":"...","language":"en","domain":"${domain}","volatility":"volatile|evergreen","sub_goals":["8 items"],"sub_labels":["8 items"],"cell_queries":{"0":"query",...,"7":"query"}}

Goal: ${goal}`;
}
