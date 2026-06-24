/**
 * v2 rich-summary translation prompt (CP499+ 출시 트랙).
 *
 * Structure-preserving: the LLM receives the EXACT nested JSON and must
 * return the SAME shape with only human-readable string values translated.
 * Numbers / booleans / ids / timestamps / URLs stay byte-identical — the
 * caller verifies key-shape equality after parse (#896 lineage: LLMs
 * routinely bend output formats; verification is mandatory, not optional).
 */

export const RICH_SUMMARY_TRANSLATE_MODEL = 'anthropic/claude-haiku-4.5';
export const RICH_SUMMARY_TRANSLATE_TEMPERATURE = 0.1;
export const RICH_SUMMARY_TRANSLATE_MAX_TOKENS = 8000;

const TARGET_LABEL: Record<string, string> = {
  ko: 'Korean',
  en: 'English',
};

export function buildRichSummaryTranslatePrompt(payload: unknown, targetLang: 'ko' | 'en'): string {
  const target = TARGET_LABEL[targetLang] ?? targetLang;
  return [
    `Translate every human-readable string value in this JSON to natural ${target}.`,
    'STRICT rules:',
    '- Return ONLY the JSON object, with EXACTLY the same keys and array lengths.',
    '- Do NOT translate or alter: numbers, booleans, ids, timestamps (e.g. "12:34"),',
    '  URLs, video ids, percentages, or enum-like machine values.',
    '- Proper nouns / tool names stay as-is.',
    '- No commentary, no markdown fence.',
    '',
    JSON.stringify(payload),
  ].join('\n');
}
