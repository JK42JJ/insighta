import { TITLE_EXAGGERATION_WORDS, TITLE_HOWTO_WORDS } from '@/config/measurement-record';
import type { TitleShape } from './types';

const DIGIT_RE = /\d/;
const BRACKET_RE = /[[\]()【】「」『』（）<>《》]/;
const EMOJI_RE = /\p{Extended_Pictographic}/gu;

function includesAny(lower: string, words: readonly string[]): boolean {
  return words.some((w) => lower.includes(w.toLowerCase()));
}

/** Pure: structural shape of a video title. */
export function titleShape(title: string | null | undefined): TitleShape {
  const t = title ?? '';
  const lower = t.toLowerCase();
  return {
    has_number: DIGIT_RE.test(t),
    has_howto: includesAny(lower, TITLE_HOWTO_WORDS),
    has_exaggeration: includesAny(lower, TITLE_EXAGGERATION_WORDS),
    emoji_count: (t.match(EMOJI_RE) ?? []).length,
    has_bracket: BRACKET_RE.test(t),
  };
}
