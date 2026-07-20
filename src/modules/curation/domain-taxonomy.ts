/**
 * Curation domain taxonomy (Growth Hub, 2026-07-20).
 * Design: docs/design/growth-hub-curation-personalized-2026-07-20.md (§4).
 *
 * trend_signals.domain is null, so keyword→domain is derived by this lightweight
 * lookup. The affinity/diversity scoring terms share this taxonomy. Substring
 * match on the lowercased keyword; first hit wins; default = 'other'.
 *
 * Target audiences (James): 취준/재직 학습/직무전환/강사/대학(원)/수험/투자/창업.
 * Content focus: fast-moving AI/ML (Claude/Codex/Gemini/Kimi/Qwen), jobs, investing, startups.
 */

export type CurationDomain =
  | 'ai_ml'
  | 'career'
  | 'investment'
  | 'startup'
  | 'language'
  | 'exam'
  | 'other';

export const CURATION_DOMAINS: readonly CurationDomain[] = Object.freeze([
  'ai_ml',
  'career',
  'investment',
  'startup',
  'language',
  'exam',
  'other',
]);

/** Ordered rules — first matching domain wins. Patterns are lowercase substrings (ko + en). */
const DOMAIN_RULES: ReadonlyArray<{ domain: CurationDomain; patterns: readonly string[] }> =
  Object.freeze([
    {
      domain: 'ai_ml',
      patterns: [
        'ai',
        '인공지능',
        'ml',
        '머신러닝',
        '딥러닝',
        'llm',
        'gpt',
        'claude',
        'codex',
        'gemini',
        'kimi',
        'qwen',
        'llama',
        'transformer',
        '생성형',
        '프롬프트',
        'prompt',
        'agent',
        '에이전트',
        'rag',
        'diffusion',
        'stable',
        'openai',
        'anthropic',
        '모델',
      ],
    },
    {
      domain: 'career',
      patterns: [
        '취업',
        '이직',
        '면접',
        '자소서',
        '커리어',
        '직무',
        '취준',
        'career',
        'interview',
        'resume',
        'job',
        '연봉',
        '개발자',
        '부트캠프',
        'bootcamp',
        '전환',
        '포트폴리오',
      ],
    },
    {
      domain: 'investment',
      patterns: [
        '투자',
        '주식',
        '재테크',
        '부동산',
        '경제',
        '금융',
        'etf',
        '코인',
        '비트코인',
        'crypto',
        'stock',
        'invest',
        'finance',
        '배당',
        '연금',
        '자산',
      ],
    },
    {
      domain: 'startup',
      patterns: [
        '창업',
        '스타트업',
        '사업',
        '공모',
        '소자본',
        '온라인창업',
        '부업',
        'startup',
        '마케팅',
        'marketing',
        '브랜딩',
        '이커머스',
        'ecommerce',
        '수익화',
        'saas',
      ],
    },
    {
      domain: 'language',
      patterns: [
        '영어',
        '토익',
        '토플',
        '오픽',
        '회화',
        '일본어',
        '중국어',
        'english',
        'toeic',
        'ielts',
        'language',
        '어학',
        '스피킹',
      ],
    },
    {
      domain: 'exam',
      patterns: [
        '수능',
        '내신',
        '공무원',
        '자격증',
        '기사',
        '고시',
        '입시',
        'exam',
        '수험',
        '모의고사',
        '검정',
      ],
    },
  ]);

/** Map a topic keyword to its curation domain (default 'other'). */
export function mapKeywordToDomain(keyword: string): CurationDomain {
  const kw = keyword.toLowerCase();
  for (const rule of DOMAIN_RULES) {
    if (rule.patterns.some((p) => kw.includes(p))) return rule.domain;
  }
  return 'other';
}
