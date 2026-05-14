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
 * Zero-dependency, deterministic — pure character-class counting.
 */

export type DetectedLanguage = 'ko' | 'en';

/** Hangul Syllables block (U+AC00–U+D7A3) — Korean pre-composed syllables. */
const HANGUL_RE = /[가-힣]/gu;
/** Basic Latin letters — the English signal. */
const LATIN_RE = /[A-Za-z]/g;

/**
 * Detect the dominant script of `text`.
 *
 *   - Any Hangul that is at least as frequent as Latin letters → 'ko'.
 *   - Latin letters present, little/no Hangul → 'en'.
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
  const hangulCount = (text.match(HANGUL_RE) ?? []).length;
  const latinCount = (text.match(LATIN_RE) ?? []).length;
  if (hangulCount === 0 && latinCount === 0) return 'ko';
  return hangulCount >= latinCount ? 'ko' : 'en';
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
