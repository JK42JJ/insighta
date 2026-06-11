/**
 * detect-language — deterministic script detection for goal/title text.
 *
 * CP458: the wizard never stored `user_mandalas.language`, and the v3
 * executor's `mandala.language === 'en' ? 'en' : 'ko'` silently defaulted
 * every NULL-language mandala to 'ko' — so an English goal ("Build
 * retirement assets via ETF investing") was searched with regionCode=KR +
 * relevanceLanguage=ko and the Korean keyword-extraction path, surfacing
 * Korean results. This helper recovers the input language from the text
 * itself so the YouTube search is issued in the right language/region.
 *
 * CP499+ (diagnosis A-3): Hangul PRESENCE now wins outright. The previous
 * count-comparison (`hangul >= latin`) let long Latin proper nouns outvote
 * Korean particles — "Claude Code로 프로덕션 앱 개발" (latin 10 vs hangul 8)
 * was judged 'en' although a Korean user typed it on a Korean keyboard.
 * Proper nouns are NOT a language signal; particles are. Measured fleet
 * impact (2026-06-11 prod, full scan): exactly 3 en-misjudged mandalas
 * corrected, 0 reverse flips (no stored-ko mandala has a Latin-only goal).
 *
 * Zero-dependency, deterministic — pure character-class testing.
 */

export type DetectedLanguage = 'ko' | 'en';

/** Hangul Syllables block (U+AC00–U+D7A3) — Korean pre-composed syllables. */
const HANGUL_RE = /[가-힣]/u;
/** Basic Latin letters — the English signal. */
const LATIN_RE = /[A-Za-z]/;

/**
 * Detect the input language of `text`.
 *
 *   - ANY Hangul → 'ko'. Typing even one Hangul syllable means a Korean
 *     keyboard/user; Latin tokens around it are proper nouns (tool names,
 *     brands) and are excluded from the judgement.
 *   - No Hangul, Latin letters present → 'en'.
 *   - No script signal at all (digits/symbols only, or empty) → 'ko',
 *     preserving the pre-CP458 default so this is never *more* surprising
 *     than the behavior it replaces.
 *
 * "Input language priority" (per product spec): the goal text the user
 * typed wins. A caller may still fall back to an explicit language
 * setting when it has one and wants to override an ambiguous detection.
 */
export function detectLanguage(text: string | null | undefined): DetectedLanguage {
  if (!text) return 'ko';
  if (HANGUL_RE.test(text)) return 'ko';
  if (LATIN_RE.test(text)) return 'en';
  return 'ko';
}

/**
 * Resolve the effective language for a mandala: a stored `'ko' | 'en'`
 * value wins (it was detected at creation time), otherwise detect from
 * the goal text. Anything that is not exactly 'ko'/'en' (NULL, '', stray
 * values) falls through to text detection rather than defaulting to 'ko'.
 */
export function resolveLanguage(
  stored: string | null | undefined,
  goalText: string | null | undefined
): DetectedLanguage {
  if (stored === 'ko' || stored === 'en') return stored;
  return detectLanguage(goalText);
}
