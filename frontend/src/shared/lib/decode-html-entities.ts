/**
 * Decode the small set of HTML entities YouTube returns in `snippet.title`
 * (`&amp;`, `&#39;`, `&quot;`, etc.). Lookup-table based — no DOM access,
 * no third-party dep, safe to call during render and in any environment.
 *
 * Why not `document.createElement('textarea').innerHTML = ...`: that path
 * also evaluates raw markup and is unnecessary surface area for a problem
 * that only ever produces 6–8 known entities in our data.
 */
const HTML_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&#39;': "'",
  '&#x27;': "'",
  '&nbsp;': ' ',
};

const ENTITY_PATTERN = /&(amp|lt|gt|quot|apos|#39|#x27|nbsp);/g;

export function decodeHtmlEntities(text: string | null | undefined): string {
  if (!text) return text ?? '';
  return text.replace(ENTITY_PATTERN, (match) => HTML_ENTITIES[match] ?? match);
}
