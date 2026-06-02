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
  const { centerGoal, subGoal, language, focusTags } = input;
  const focusLine = focusTags?.length ? `- 집중 분야: ${focusTags.join(', ')}` : '';

  if (language === 'ko') {
    return `YouTube에서 "${centerGoal}" 목표 중 "${subGoal}" 영역의 학습 영상을 찾아야 합니다.

실제 사용자가 YouTube 검색창에 입력하는 것처럼 검색어 5개를 만드세요.
${focusLine ? '\n' + focusLine : ''}

[검색어 구성 공식]
  {중심목표 핵심어 1-2개} + {세부영역 핵심어 1-2개}
  총 12-20자. 중심목표와 세부영역 키워드가 각각 최소 1개씩 반드시 포함.

[좋은 검색어 — 균형 잡힌 길이, 맥락 유지]
"영어 회화 스피킹 자신감" → 목표(영어 회화) + 영역(자신감) 결합
"투자 포트폴리오 심리 관리" → 목표(투자 포트폴리오) + 영역(심리) 결합
"체지방 감량 홈트 기구 추천" → 목표(체지방 감량) + 영역(기구) 결합
"코딩 번아웃 극복법" → 목표(코딩) + 영역(번아웃) 결합

[나쁜 검색어 — 너무 짧아서 맥락 손실]
"심리 관리법" → 중심목표 키워드 없음. 일반 자기계발로 확산
"자신감 키우기" → "영어"가 빠져서 일반 자기계발 영상 노출
"멘탈 트레이닝" → "투자"가 빠져서 스포츠 멘탈 영상 노출

[나쁜 검색어 — 너무 길어서 검색 실패]
"영어 회화 자신감 없을 때 극복하는 방법 2025" → 문장형, YouTube에서 매칭 안 됨
"투자 포트폴리오 리밸런싱 시 인지 편향 피하기" → 논문 제목 같음, 관련 영상 없음

[다양성]
5개 중 최소 3개는 서로 다른 관점으로 검색:
방법론 / 경험담 / 도구추천 / 실수방지 / 루틴

JSON 배열만 출력:
["검색어1", "검색어2", "검색어3", "검색어4", "검색어5"]`;
  }

  return `Find YouTube videos about "${subGoal}" within the goal "${centerGoal}".

Write 5 search queries AS A REAL USER would type into YouTube search bar.
${focusLine ? '\n' + focusLine : ''}

[Query formula]
  {goal keyword 1-2} + {area keyword 1-2}
  Total 3-6 words. Must include at least 1 keyword from main goal AND 1 from sub area.

[Good queries — balanced length, context preserved]
"developer imposter syndrome tips" → goal(developer) + area(imposter syndrome)
"investment portfolio risk psychology" → goal(portfolio) + area(psychology)
"body fat loss home gym setup" → goal(body fat) + area(gym setup)
"coding burnout recovery habits" → goal(coding) + area(burnout)

[Bad queries — too short, context lost]
"imposter syndrome" → missing "developer", returns generic self-help
"mental training" → missing "investment", returns sports psychology
"confidence tips" → missing domain context entirely

[Bad queries — too long, search fails]
"how to overcome imposter syndrome as a developer in 2025" → sentence, not a search
"investment portfolio rebalancing cognitive bias avoidance" → academic title

[Diversity]
At least 3 of 5 from different angles:
how-to / stories / tools / mistakes / routine

JSON array only:
["query1", "query2", "query3", "query4", "query5"]`;
}

export interface PerCellSearchQueryPromptInput {
  centerGoal: string;
  /** Cell labels in cell order (index 0..N-1). */
  subLabels: string[];
  language: string;
  focusTags?: string[];
}

/**
 * Per-cell query generation: ONE prompt → ONE searchable query per cell, as a
 * JSON object keyed by cell index. A single LLM call sees all cells at once, so
 * it keeps the center context consistent and avoids cross-cell duplicate queries
 * (the rule-based path emitted e.g. center+"세계 일주" duplicating the center).
 *
 * Same anti-failure guidance as buildSearchQueryPrompt: each query 12-20 chars,
 * goal+area combined — never too-short (→ generic self-help) nor sentence-long
 * (→ no YouTube match → high-view global backfill). Verified (CP492): Haiku 4.5
 * produced clean per-cell queries in ~2.2s, JSON-stable, search.list pools 5-10/10
 * relevant vs rule-based 0/4 garbage.
 */
export function buildPerCellSearchQueryPrompt(input: PerCellSearchQueryPromptInput): string {
  const { centerGoal, subLabels, language, focusTags } = input;
  const n = subLabels.length;
  const areas = subLabels.map((l, i) => `${i}. ${l}`).join('\n');
  const focusLine = focusTags?.length
    ? language === 'ko'
      ? `- 집중 분야: ${focusTags.join(', ')}`
      : `- Focus: ${focusTags.join(', ')}`
    : '';

  if (language === 'ko') {
    return `당신은 YouTube 검색어 생성기입니다. 목표와 ${n}개 세부영역이 주어집니다. 각 세부영역마다 실제 사용자가 YouTube 검색창에 입력할 한국어 검색어 1개를 만드세요.

목표: "${centerGoal}"
세부영역:
${areas}
${focusLine ? '\n' + focusLine : ''}

[규칙]
- 각 검색어 12~20자. {목표 핵심어 1~2개} + {세부영역 핵심어 1~2개} 결합. 의미가 살아있는 검색가능한 표현.
- 너무 짧으면(예: "시간 관리", "보험") 일반 콘텐츠로 확산 → 금지.
- 너무 길거나 문장형(예: "매일 학습할 수 있는 시간 블록 설정하는 방법")이면 YouTube 매칭 실패 → 금지.
- 세부영역의 실제 의도를 반영 (예: "시간 블록 설정"→"공부 시간관리 루틴", "프로토타입 개발"→"노코드 MVP 제작").

[출력] JSON 객체만, 키는 세부영역 번호(문자열 "0"~"${n - 1}"), 값은 검색어:
{"0":"검색어", ..., "${n - 1}":"검색어"}`;
  }

  return `You are a YouTube search query generator. Given a goal and ${n} sub-areas, write ONE search query a real user would type, for each sub-area.

Goal: "${centerGoal}"
Sub-areas:
${areas}
${focusLine ? '\n' + focusLine : ''}

[Rules]
- Each query 3-6 words. {goal keyword 1-2} + {area keyword 1-2}. A real, searchable phrase.
- Too short (e.g. "time management", "insurance") → spreads to generic content → forbidden.
- Too long / sentence-like → no YouTube match → forbidden.
- Reflect the sub-area's real intent (e.g. "prototype dev" → "no-code MVP build").

[Output] JSON object only, keys are sub-area indices (strings "0".."${n - 1}"), values are queries:
{"0":"query", ..., "${n - 1}":"query"}`;
}
