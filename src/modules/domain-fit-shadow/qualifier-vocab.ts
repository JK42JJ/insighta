/**
 * Domain-fit lexical qualifier vocab (R22-1 — search redesign, non-LLM
 * conflict-detection layer on top of the frozen T3 domain-fit classifier).
 *
 * Narrow, closed vocab lists (per-category) used by `lexical-qualifier.ts` to
 * detect a QUALIFIER CONFLICT between a mandala goal and a candidate video
 * title — e.g. goal says "영어" (English) but the title's language qualifier
 * is "일본어" (Japanese). This is a SIGNAL (deboost multiplier), never a hard
 * cut, and never LLM-driven — pure string matching against the closed lists
 * below. Deliberately narrow (not general-purpose NER): only categories where
 * R20/R20-1 measurement showed a real, repeated LLM over-pass pattern
 * (docs/qa/domain-fit-r20-polysemy-overpass-n-expansion.md — 회화 40%,
 * 코드 25% over-pass; cloud-vendor collision found in R20-1 WRITE-edge set).
 *
 * Extending a category (or adding a new one) requires the same measurement
 * discipline as this file's origin: a real over-pass pattern, not a guess.
 * Do NOT add generic/ambiguous tokens without word-boundary review — see the
 * `기타` (guitar vs "etc.") caveat on INSTRUMENT_VOCAB below.
 */

export const QUALIFIER_CATEGORIES = ['language', 'cloud_vendor', 'instrument'] as const;
export type QualifierCategory = (typeof QUALIFIER_CATEGORIES)[number];

/** surface term (as it appears in Korean/English titles) -> canonical value id within its category. */
export type QualifierVocabMap = Readonly<Record<string, string>>;

/**
 * Language-name qualifiers. Source: R20-2 회화 (conversation) cluster —
 * goal "100일 영어 회화 완성하기" (English) repeatedly over-passed against
 * real off-domain titles naming a DIFFERENT language explicitly
 * (일본어/중국어/스페인어/프랑스어/베트남어), 40.0% over-pass at N=30
 * (docs/qa/domain-fit-r20-polysemy-overpass-n-expansion.md).
 *
 * Deliberately matches only the explicit "-어" language-name form, NOT bare
 * country names (e.g. "스페인" alone does not imply "스페인어" — a Spain
 * travel-vlog title is not automatically a Spanish-language lesson). This is
 * a conservative choice: it under-catches (see R22-2 measurement) rather
 * than risk conflating travel/culture content with language content.
 */
export const LANGUAGE_VOCAB: QualifierVocabMap = {
  일본어: 'ja',
  중국어: 'zh',
  영어: 'en',
  스페인어: 'es',
  프랑스어: 'fr',
  베트남어: 'vi',
  독일어: 'de',
  한국어: 'ko',
};

/**
 * Cloud-vendor qualifiers. Source: R20-1 WRITE-edge over-pass row R014 (goal
 * "KT 클라우드 강의안 작성" vs title "...오라클 클라우드" — different vendor,
 * gold 비적합, LLM over-passed 적합).
 */
export const CLOUD_VENDOR_VOCAB: QualifierVocabMap = {
  오라클: 'oracle',
  oracle: 'oracle',
  azure: 'azure',
  aws: 'aws',
  kt클라우드: 'kt',
  kt: 'kt',
  네이버클라우드: 'naver',
  네이버: 'naver',
  gcp: 'gcp',
  구글클라우드: 'gcp',
  'google cloud': 'gcp',
};

/**
 * Instrument qualifiers. Source: R16 niche_legit/niche_drift instrument-goal
 * clusters (classical guitar / piano goals vs off-instrument titles).
 *
 * CAVEAT (honesty, not swept under the rug): `기타` is a genuine Korean
 * homograph — "guitar" vs "etc./and so on" (as in "기타 등등"). A false
 * conflict is only possible when the OTHER side also names a *different*
 * instrument (absence never deboosts — see lexical-qualifier.ts), so the
 * blast radius of this ambiguity is narrow, but it is not zero. Flagged
 * explicitly in the R22-2 measurement report rather than silently accepted.
 */
export const INSTRUMENT_VOCAB: QualifierVocabMap = {
  기타: 'guitar',
  피아노: 'piano',
  드럼: 'drums',
  바이올린: 'violin',
  우쿨렐레: 'ukulele',
  베이스: 'bass',
};

export const QUALIFIER_VOCAB_BY_CATEGORY: Readonly<Record<QualifierCategory, QualifierVocabMap>> = {
  language: LANGUAGE_VOCAB,
  cloud_vendor: CLOUD_VENDOR_VOCAB,
  instrument: INSTRUMENT_VOCAB,
};
