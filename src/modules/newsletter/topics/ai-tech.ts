/**
 * ai-tech — what this brief searches for, written down.
 *
 * Issue 1's harvest ran from a script that was never committed. Its 40 queries
 * are gone, which means the corpus behind "2,714 videos" cannot be reproduced
 * and the next issue cannot be measured against the last one. The queries live
 * here so a week-to-week comparison means something.
 *
 * The boundary is narrower than the name. The master spec (§23) lists AI and
 * 개발 as separate briefs and `CATEGORY_KEYS` matches, so this one is the change
 * in AI itself — models, pricing, agents, inference, the tooling around them.
 * General programming is `dev`'s. "Building with Claude Code" belongs here;
 * "what's new in React 19" does not.
 */

export interface TopicDefinition {
  categoryKey: string;
  /** YouTube videoCategoryId values. One call per value — CSV returns HTTP 400. */
  videoCategoryIds: number[];
  /** Harvest window in days. */
  publishedWithinDays: number;
  /**
   * `date`, always. The client omits the parameter when it is `relevance`,
   * and the result then leans on popularity, which is the opposite of what a
   * weekly brief needs.
   */
  order: 'date';
  queries: { ko: string[]; en: string[] };
  /** Applied at S3. Present here so the boundary is one file, not two. */
  exclude: string[];
}

/**
 * Categories.
 *
 * 28 (Science & Technology) only. 27 (Education) is where lecture courses,
 * language study and exam prep live, and issue 1's own funnel records dropping
 * stock and property videos that arrived through it. Blocking at intake is
 * cheaper and more honest than filtering after.
 */
const VIDEO_CATEGORY_SCIENCE_TECH = 28;

/**
 * Both languages, always.
 *
 * Issue 1 measured why: the DeepSeek harness story ran 11 English videos to 4
 * Korean, and Furiosa ran 5 Korean to 0 English. Either language alone misses
 * one of them.
 */
export const AI_TECH: TopicDefinition = {
  categoryKey: 'ai-tech',
  videoCategoryIds: [VIDEO_CATEGORY_SCIENCE_TECH],
  publishedWithinDays: 7,
  order: 'date',

  queries: {
    ko: [
      // model releases and comparisons
      'LLM 신규 모델 공개',
      '오픈소스 LLM 공개',
      'AI 모델 벤치마크 비교',
      '모델 성능 비교 실측',
      // pricing and cost
      'LLM API 요금',
      'AI 토큰 비용 절감',
      '추론 비용 계산',
      // agents and tooling
      '코딩 에이전트',
      'AI 에이전트 만들기',
      'AI 에이전트 툴 사용',
      'MCP 서버 만들기',
      // context and prompting
      '시스템 프롬프트 설계',
      '컨텍스트 엔지니어링',
      'RAG 구축',
      // inference infrastructure
      '로컬 LLM 구동',
      'LLM 파인튜닝',
      '모델 양자화',
      'LLM 서빙 최적화',
      // security and incidents
      '프롬프트 인젝션',
      'LLM 보안 취약점',
    ],
    en: [
      'new LLM model release',
      'open weights model release',
      'LLM benchmark comparison',
      'model evaluation results',
      'LLM API pricing change',
      'inference cost optimization',
      'token cost reduction',
      'coding agent',
      'building AI agents',
      'agent tool use',
      'MCP server tutorial',
      'system prompt design',
      'context engineering',
      'RAG implementation',
      'run LLM locally',
      'fine-tuning LLM',
      'model quantization',
      'vLLM serving',
      'prompt injection attack',
      'LLM security vulnerability',
    ],
  },

  /**
   * Applied at S3, phrased as what an editor would say out loud when rejecting.
   *
   * The last line is the boundary with `dev`, and it is the one that decides
   * most of the borderline cases.
   */
  exclude: [
    'gadget or hardware review (phones, laptops, GPUs as products)',
    'income claims — "I made $X with AI"',
    'beginner courses, certifications, bootcamp promotion',
    'news-roundup channels with no first-hand material',
    'general programming — languages, frameworks, algorithms (belongs to dev)',
  ],
};

/**
 * Calls one harvest of this topic will make.
 *
 * search.list is 100 units and `videoCategoryId` takes a single value per call
 * (CSV returns HTTP 400 — measured 2026-08-25), so the count is queries times
 * categories. Trusted channels are not counted here: those go through
 * playlistItems.list at 1 unit each and are counted by the harvest itself.
 */
export function searchQuotaCost(topic: TopicDefinition): {
  calls: number;
  units: number;
} {
  const queryCount = topic.queries.ko.length + topic.queries.en.length;
  const calls = queryCount * topic.videoCategoryIds.length;
  return { calls, units: calls * 100 };
}
