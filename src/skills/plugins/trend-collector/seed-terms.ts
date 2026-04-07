/**
 * trend-collector — learning seed terms (Phase 1.5a, Decision 1=a)
 *
 * Hardcoded list of ~30 Korean learning-domain seed terms used to drive
 * the YouTube Search Suggest API. Each seed is sent to Suggest, the
 * autocomplete results become trend_signals rows.
 *
 * Selection rationale: cover the 5 mandala domains documented in
 * mandala_embeddings (기술/개발, 학습/교육, 건강/피트니스, 비즈니스/커리어,
 * 라이프스타일/여행) with recognizable learning-intent words. Each seed
 * is a 1-3 token Korean phrase that maps to a clear learning goal.
 *
 * NOT exhaustive — Phase 1.5b can extend this list. The list is small
 * (~30) on purpose so the smoke run is fast and the keyword space stays
 * focused.
 *
 * Phase 1.5b will optionally extract additional seeds from
 * mandala_embeddings.center_goal via LLM clustering.
 */

export interface LearningSeed {
  term: string;
  /** Mandala domain this seed belongs to (matches mandala_embeddings.domain). */
  domain: string;
}

export const LEARNING_SEED_TERMS: readonly LearningSeed[] = Object.freeze([
  // 기술/개발 (Tech / Development)
  { term: '파이썬', domain: '기술/개발' },
  { term: '자바스크립트', domain: '기술/개발' },
  { term: 'AI', domain: '기술/개발' },
  { term: '데이터분석', domain: '기술/개발' },
  { term: '리액트', domain: '기술/개발' },
  { term: '머신러닝', domain: '기술/개발' },
  { term: 'SQL', domain: '기술/개발' },
  { term: '알고리즘', domain: '기술/개발' },

  // 학습/교육 (Learning / Education)
  { term: '토익', domain: '학습/교육' },
  { term: '영어회화', domain: '학습/교육' },
  { term: '한국사', domain: '학습/교육' },
  { term: '수능', domain: '학습/교육' },
  { term: '독서', domain: '학습/교육' },
  { term: '글쓰기', domain: '학습/교육' },

  // 비즈니스/커리어 (Business / Career)
  { term: '주식', domain: '비즈니스/커리어' },
  { term: '가치투자', domain: '비즈니스/커리어' },
  { term: '배당 ETF', domain: '비즈니스/커리어' },
  { term: '부동산 투자', domain: '비즈니스/커리어' },
  { term: '마케팅', domain: '비즈니스/커리어' },
  { term: '창업', domain: '비즈니스/커리어' },

  // 건강/피트니스 (Health / Fitness)
  { term: '홈트레이닝', domain: '건강/피트니스' },
  { term: '러닝', domain: '건강/피트니스' },
  { term: '요가', domain: '건강/피트니스' },
  { term: '식단', domain: '건강/피트니스' },
  { term: '근력운동', domain: '건강/피트니스' },

  // 라이프스타일/여행 (Lifestyle / Travel)
  { term: '디지털 노마드', domain: '라이프스타일/여행' },
  { term: '미니멀리즘', domain: '라이프스타일/여행' },
  { term: '워케이션', domain: '라이프스타일/여행' },
  { term: '부업', domain: '라이프스타일/여행' },
  { term: '시간관리', domain: '라이프스타일/여행' },
]);

export const LEARNING_SEED_TERMS_COUNT = LEARNING_SEED_TERMS.length;
