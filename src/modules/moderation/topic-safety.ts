/**
 * Topic safety gate (2026-07-27).
 *
 * The curation suggester ranks `trend_signals` keywords straight from the
 * collector, and `norm_score` is raw popularity — so `ai 란제리 룩북` sat at
 * score 1.00 and was proposed, labelled "AI·기술", as a study subject on a
 * learning product. Nothing between the collector and the user asked whether a
 * keyword was appropriate at all.
 *
 * Two enforcement points, same predicate:
 *   - collector side  — never persist a blocked keyword
 *   - serving side    — never propose one, including rows already in the table
 *
 * Matching is deliberately dumb and deterministic (substring over a normalised
 * string). It is a floor, not a classifier: it must never let something through
 * because a model was unsure. Ranking quality is a separate concern (#1357).
 *
 * Educational framing is the one carve-out. "청소년 도박 예방 교육" contains a
 * blocked term but is exactly the kind of material this product exists for, so a
 * context term rescues it — unless the keyword also carries an explicit-content
 * term, which nothing rescues.
 */

/** Blocked substrings by category. Normalised (lowercased, spaces stripped) before matching. */
const BLOCKED = Object.freeze({
  /** Sexual / suggestive. Nothing here is rescuable by educational context. */
  explicit: [
    '란제리',
    '룩북',
    '비키니',
    '노출의상',
    '섹시',
    '야한',
    '19금',
    '성인용',
    '성인물',
    '글래머',
    '몸매노출',
    '벗는',
    '벗기',
    '누드',
    '야동',
    'av배우',
    '유흥',
    'lingerie',
    'lookbook',
    'bikini',
    'sexy',
    'nsfw',
    'onlyfans',
    'nude',
    'hentai',
  ],
  /** Gambling / speculation-as-entertainment. */
  gambling: [
    '카지노',
    '바카라',
    '슬롯머신',
    '토토사이트',
    '먹튀',
    '홀덤',
    '사설betting',
    '베팅사이트',
    'casino',
    'baccarat',
    'betting',
  ],
  /** Pump-and-dump style financial solicitation. */
  solicitation: ['리딩방', '종목추천', '급등주', '코인리딩', '단타비법', '수익인증', '원금보장'],
  /** Illegal / harmful. */
  illegal: [
    '마약',
    '대마초',
    '필로폰',
    '총기제작',
    '폭탄제조',
    '해킹툴',
    '불법다운',
    '토렌트다운',
    '자살방법',
    '자해방법',
  ],
  /**
   * Hate / dehumanising. Terms here must be the SLUR OR THE ACT OF PROMOTING it,
   * never the name of the social problem — otherwise reporting, documentary and
   * first-hand accounts get blocked along with the abuse. `인종차별` was in this
   * list on the first pass and took out `호주 여행 인종차별` (norm_score 0.80), a
   * traveller describing racism they experienced. That is exactly the material a
   * learning product should carry.
   */
  hate: ['혐오표현', '혐오조장', '인종차별조장', '일베', '패드립'],
});

/**
 * Terms that mark a keyword as being ABOUT a problem rather than promoting it —
 * prevention, education, recovery, journalism.
 */
const EDUCATIONAL_CONTEXT = Object.freeze([
  '예방',
  '교육',
  '중독',
  '상담',
  '치료',
  '회복',
  '캠페인',
  '피해',
  '대응',
  '보호',
  '규제',
  '정책',
  '리터러시',
  '윤리',
  'prevention',
  'education',
  'awareness',
  'recovery',
  'policy',
  'ethics',
]);

/** Categories no context can rescue. */
const NEVER_RESCUABLE: ReadonlyArray<keyof typeof BLOCKED> = ['explicit'];

export type TopicSafetyVerdict =
  | { safe: true }
  | { safe: false; category: keyof typeof BLOCKED; term: string };

/** Lowercase + strip whitespace so "란 제 리" and "LOOKBOOK" both match. */
function normalise(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '');
}

/** Does the keyword read as being about the problem rather than selling it? */
function hasEducationalContext(normalised: string): boolean {
  return EDUCATIONAL_CONTEXT.some((c) => normalised.includes(normalise(c)));
}

/**
 * Verdict for one topic/keyword. Pure — no DB, no network — so both the
 * collector and the serving path can call it on every row without cost.
 */
export function checkTopicSafety(keyword: string): TopicSafetyVerdict {
  const n = normalise(keyword);
  if (!n) return { safe: true };

  for (const [category, terms] of Object.entries(BLOCKED) as Array<
    [keyof typeof BLOCKED, readonly string[]]
  >) {
    for (const term of terms) {
      if (!n.includes(normalise(term))) continue;
      if (!NEVER_RESCUABLE.includes(category) && hasEducationalContext(n)) continue;
      return { safe: false, category, term };
    }
  }
  return { safe: true };
}

/** Convenience predicate for `.filter(...)` call sites. */
export function isTopicSafe(keyword: string): boolean {
  return checkTopicSafety(keyword).safe;
}

/** Exposed for the admin audit endpoint and tests. */
export const TOPIC_SAFETY_CATEGORIES = Object.keys(BLOCKED) as Array<keyof typeof BLOCKED>;
