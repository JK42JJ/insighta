/**
 * M1: Title-Content Overlap — measures how much of the video title
 * is reflected in the structured summary content.
 */

// Korean stopwords (common particles/suffixes that add no specificity)
const KO_STOPWORDS = new Set([
  '의',
  '가',
  '이',
  '은',
  '는',
  '을',
  '를',
  '에',
  '에서',
  '와',
  '과',
  '도',
  '로',
  '으로',
  '에게',
  '한',
  '하는',
  '된',
  '하다',
  '있다',
  '없다',
  '것',
  '수',
  '등',
  '및',
  '더',
  '또',
  '그',
  '이런',
  '저런',
  '그런',
  '위한',
  '대한',
  '통한',
  '관한',
]);

// English stopwords
const EN_STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'could',
  'should',
  'may',
  'might',
  'can',
  'shall',
  'to',
  'of',
  'in',
  'for',
  'on',
  'with',
  'at',
  'by',
  'from',
  'as',
  'into',
  'through',
  'during',
  'before',
  'after',
  'above',
  'below',
  'between',
  'and',
  'but',
  'or',
  'not',
  'no',
  'nor',
  'so',
  'if',
  'then',
  'than',
  'that',
  'this',
  'these',
  'those',
  'it',
  'its',
  'how',
  'what',
  'which',
  'who',
  'whom',
]);

const MIN_TOKEN_LENGTH = 2;

/**
 * Tokenize text into a deduplicated set of meaningful lowercase tokens.
 * Strips punctuation, splits on whitespace, and removes stopwords.
 */
function tokenize(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ') // keep letters and numbers
    .split(/\s+/)
    .filter((t) => t.length >= MIN_TOKEN_LENGTH)
    .filter((t) => !KO_STOPWORDS.has(t) && !EN_STOPWORDS.has(t));
  return new Set(tokens);
}

/**
 * Measure the fraction of title tokens that appear in contentTexts.
 *
 * @param title - Video title
 * @param contentTexts - Flat array of text strings extracted from the summary
 * @returns Overlap ratio in [0, 1]. Returns 0 if title has no meaningful tokens.
 */
export function measureTitleOverlap(title: string, contentTexts: string[]): number {
  const titleTokens = tokenize(title);
  if (titleTokens.size === 0) return 0;

  const contentText = contentTexts.join(' ');
  const contentTokens = tokenize(contentText);

  let matchCount = 0;
  for (const token of titleTokens) {
    if (contentTokens.has(token)) matchCount++;
  }

  return matchCount / titleTokens.size;
}

/**
 * Extract flat array of content text strings from a structured summary (V1 or V2).
 * Covers atoms (V2), key_points (V1), core_argument, tl_dr_ko, tl_dr_en.
 */
export function extractContentTexts(structured: Record<string, unknown>): string[] {
  const texts: string[] = [];

  // V2: atoms
  const atoms = structured['atoms'] as Array<{ text?: string }> | undefined;
  if (Array.isArray(atoms)) {
    for (const atom of atoms) {
      if (atom.text) texts.push(atom.text);
    }
  }

  // V1: key_points
  const keyPoints = structured['key_points'] as Array<{ text?: string } | string> | undefined;
  if (Array.isArray(keyPoints)) {
    for (const kp of keyPoints) {
      if (typeof kp === 'string') texts.push(kp);
      else if (kp.text) texts.push(kp.text);
    }
  }

  // Also include core_argument, tl_dr_ko, tl_dr_en
  if (typeof structured['core_argument'] === 'string') texts.push(structured['core_argument']);
  if (typeof structured['tl_dr_ko'] === 'string') texts.push(structured['tl_dr_ko']);
  if (typeof structured['tl_dr_en'] === 'string') texts.push(structured['tl_dr_en']);

  return texts;
}
