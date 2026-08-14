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
  | 'startup'
  | 'investment'
  | 'health'
  | 'learning'
  | 'policy'
  | 'creator'
  | 'lifestyle'
  | 'other';

/**
 * The nine weekly editions (James 2026-08-04), in their canonical order, plus
 * the 'other' fallback. `language` and `exam` merged into `learning`: both were
 * "someone studying", and splitting them left each too thin to fill an edition.
 *
 * Smart Shopping is deliberately absent — measured supply was 30 fresh keywords
 * of 1,879, and the cause is structural. See P2-보류 in
 * docs/handoffs/pool-inflow-ledger.md for the conditions to add it.
 */
export const CURATION_DOMAINS: readonly CurationDomain[] = Object.freeze([
  'ai_ml',
  'career',
  'startup',
  'investment',
  'health',
  'learning',
  'policy',
  'creator',
  'lifestyle',
  'other',
]);

/**
 * Short ASCII patterns match on a word boundary; everything else is a plain
 * substring. Without this, 'ai' claims appalachian trail, email marketing,
 * detail and chair yoga, and 'ml' claims html — measured against the live
 * keyword set, so the tagging backfill would have written that in.
 * Korean patterns need no boundary: the language does not glue them into
 * unrelated words the way English does.
 */
const SHORT_ASCII = /^[a-z]{1,3}$/;
function patternHits(haystack: string, pattern: string): boolean {
  if (SHORT_ASCII.test(pattern)) {
    return new RegExp(`(^|[^a-z])${pattern}([^a-z]|$)`).test(haystack);
  }
  return haystack.includes(pattern);
}

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
        'gemini',
        '생성형',
        '프롬프트',
        '에이전트',
        '자율주행',
        '양자',
        '알고리즘',
        '데이터',
        '개발',
        '코딩',
        '프로그래',
        '파이썬',
        'python',
        '자바',
        'javascript',
        '리액트',
        'kubernetes',
        'devops',
        'sql',
        '클라우드',
        '서버',
        '아키텍처',
        '임베디드',
        '로봇',
        'iot',
        '블록체인',
        '리눅스',
        '컴파일러',
        'saas',
        'api',
        // English technical terms the Korean patterns above do not reach. Without
        // these "reinforcement learning" lands in `learning`, which is the study
        // domain — the word is shared, the subject is not.
        'reinforcement',
        'neural',
        'transformer',
        'computer vision',
        'nlp',
        'kubernetes',
        'webassembly',
        'microservice',
        'serverless',
        'compiler',
        '마이크로서비스',
        '서버리스',
        '분산 시스템',
        '메시지 큐',
        '데이터베이스',
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
        '연봉',
        '인턴',
        '채용',
        '포트폴리오',
        '부트캠프',
        '자격증',
        '고시',
        '공무원',
        '전문성',
        'career',
        'resume',
        'interview',
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
        '부업',
        '수익화',
        '수익 창출',
        '경영',
        '생산성',
        '이커머스',
        'ecommerce',
        'startup',
        '구독서비스',
        '세일즈',
        'esg',
        '지속가능경영',
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
        '코인',
        '비트코인',
        'etf',
        '배당',
        '연금',
        '자산',
        '펀드',
        '옵션',
        '커버드콜',
        '스테이킹',
        '가상화폐',
        '세금',
        '재무',
        '재정',
        '부채',
        '임대',
        '경매',
        'stock',
        'invest',
        'finance',
      ],
    },
    {
      domain: 'health',
      patterns: [
        '건강',
        '운동',
        '수면',
        '근력',
        '다이어트',
        '식단',
        '요가',
        '명상',
        '마라톤',
        '주짓수',
        '체력',
        '심장',
        '스킨케어',
        '장수',
        '트레이닝',
        '스포츠',
        '격투기',
        '재활',
        '마음챙김',
        '헬스',
        '영양',
        'fitness',
        'health',
        'yoga',
        'workout',
      ],
    },
    {
      domain: 'learning',
      patterns: [
        '영어',
        '토익',
        '토플',
        '오픽',
        '회화',
        '일본어',
        '중국어',
        '어학',
        '스피킹',
        'english',
        'toeic',
        'ielts',
        'language',
        '수능',
        '내신',
        '입시',
        '수험',
        '모의고사',
        '검정',
        'exam',
        '공부',
        '학습',
        '강의',
        '논문',
        '학위',
        '교육',
        '속독',
        '자기계발',
        '습관',
        '집중력',
        '시간관리',
        '마인드맵',
        '글쓰기',
        'study',
        'learning',
        'edtech',
      ],
    },
    {
      domain: 'policy',
      patterns: [
        '정책',
        '지원사업',
        '복지',
        '제도',
        '정부',
        '노인',
        '장애',
        '돌봄',
        '자원봉사',
        '지역사회',
        '청년',
        '공공',
        '사회복지',
        '연금제도',
        'policy',
        'welfare',
        'disability',
        'accessibility',
        'inclusion',
      ],
    },
    {
      domain: 'creator',
      patterns: [
        '마케팅',
        '콘텐츠',
        '브랜딩',
        'sns',
        '유튜브',
        '뉴스레터',
        '크리에이터',
        '일러스트',
        '디자인',
        '캘리그라피',
        '영상편집',
        '사진',
        '출판',
        '저작',
        'marketing',
        'branding',
        'content',
        'design',
        'youtube',
      ],
    },
    {
      domain: 'lifestyle',
      patterns: [
        '여행',
        '라이프',
        '트렌드',
        '미니멀',
        '노마드',
        '디톡스',
        '공예',
        '취미',
        '정원',
        '제로웨이스트',
        '하이킹',
        '등산',
        '자전거',
        '캠핑',
        '보드게임',
        '반려',
        '요리',
        '인테리어',
        '명상음악',
        '순례',
        '철도',
        '워케이션',
        'travel',
        'hobby',
        'lifestyle',
      ],
    },
  ]);

/** Map a topic keyword to its curation domain (default 'other'). */
export function mapKeywordToDomain(keyword: string): CurationDomain {
  const kw = keyword.toLowerCase();
  for (const rule of DOMAIN_RULES) {
    if (rule.patterns.some((p) => patternHits(kw, p))) return rule.domain;
  }
  return 'other';
}

/**
 * Extract interest keywords from a title by matching the taxonomy patterns —
 * a LOCAL, LLM-free substitute for the interest-profile build (prod's LLM
 * extractor was too slow: hundreds of titles × sequential calls stalled the
 * "analyzing" state). Returns every matched pattern with its domain; empty when
 * the title matches no known interest area.
 */
export function extractTaxonomyKeywords(
  text: string
): Array<{ kw: string; domain: CurationDomain }> {
  const lower = text.toLowerCase();
  const out: Array<{ kw: string; domain: CurationDomain }> = [];
  const seen = new Set<string>();
  for (const rule of DOMAIN_RULES) {
    for (const p of rule.patterns) {
      // Require ≥2 chars so single-letter noise (ml/ai are intentional) is bounded,
      // and dedupe so a repeated pattern in one title counts once.
      if (p.length >= 2 && patternHits(lower, p) && !seen.has(p)) {
        seen.add(p);
        out.push({ kw: p, domain: rule.domain });
      }
    }
  }
  return out;
}
