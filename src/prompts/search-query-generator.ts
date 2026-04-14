/**
 * Prompt #3: YouTube search query generation for video-discover.
 *
 * Replaces the Ollama+OpenRouter race in llm-query-generator.ts with
 * a single Haiku call via OpenRouter. Simpler, more consistent quality.
 *
 * @see docs/design/wizard-redesign-v2.md Phase 1
 */

export const SEARCH_QUERY_MODEL = 'anthropic/claude-haiku-4.5';
export const SEARCH_QUERY_TEMPERATURE = 0.7;
export const SEARCH_QUERY_MAX_TOKENS = 300;

export interface SearchQueryPromptInput {
  centerGoal: string;
  subGoal: string;
  language: string;
  focusTags?: string[];
  targetLevel?: string;
}

export function buildSearchQueryPrompt(input: SearchQueryPromptInput): string {
  const { centerGoal, subGoal, language, focusTags, targetLevel } = input;
  const level = targetLevel ?? 'standard';
  const focusLine = focusTags?.length ? `- Focus areas: ${focusTags.join(', ')}` : '';

  if (language === 'ko') {
    return `학습 영상을 찾기 위한 YouTube 검색어를 5개 생성하세요.

만다라 컨텍스트:
- 중심 목표: ${centerGoal}
- 구체 영역: ${subGoal}
${focusLine ? focusLine + '\n' : ''}- 목표 수준: ${level} (foundation=기초/standard=중급/advanced=심화)

규칙:
- 모든 검색어는 반드시 한국어로 작성
- 키워드 나열이 아닌 검색 의도를 담은 자연어 검색어
- 목표 수준에 맞는 검색어:
  - foundation: "입문", "기초", "처음 배우는"
  - standard: "실전", "활용법", "중급"
  - advanced: "심화", "마스터", "전문가"
- 최소 1개는 연도(2025 또는 2026)를 포함하여 최신 영상 검색
- 너무 일반적인 검색어 금지 — ${subGoal}에 구체적으로 맞출 것

JSON 배열만 출력:
["검색어1", "검색어2", "검색어3", "검색어4", "검색어5"]`;
  }

  return `Generate 5 YouTube search queries for finding learning videos.

MANDALA CONTEXT:
- Main goal: ${centerGoal}
- Specific area: ${subGoal}
${focusLine ? focusLine + '\n' : ''}- Target level: ${level} (foundation/standard/advanced)

RULES:
- ALL queries must be in English
- Capture the INTENT, not just keywords
- Match queries to target level:
  - foundation: "tutorial", "getting started", "beginner guide"
  - standard: "practice", "intermediate", "hands-on"
  - advanced: "advanced", "expert", "mastery"
- Include at least 1 query with a year (2025 or 2026) for freshness
- Avoid generic queries — be specific to the sub_goal

OUTPUT: JSON array only.
["query1", "query2", "query3", "query4", "query5"]`;
}
