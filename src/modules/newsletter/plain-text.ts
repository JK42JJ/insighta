/**
 * Inline HTML to prose.
 *
 * The dek carries `<strong>` for the page. Anywhere it is shown as text --
 * the list card's summary, the mail deck, a document title -- the tags must
 * go at the point the excerpt is made, not at render time, so no surface can
 * forget. Entities are decoded because a stripped `&amp;` is not prose either.
 */

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

export function plainText(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => ENTITIES[m] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}
