import type { MorningPage } from '@/features/morning-cards/api';

/*
 * The sentences of a brief and the sources behind each one (order 2026-11-25 B5, D1), pure. The
 * ids are what the usage records name a sentence by, so the pipeline numbers them the same way:
 * this comment is the rule, brief-sentences.fixture.json (a published page) and its expected ids
 * in brief-sentences.test.ts are the check for another implementation.
 *
 * Input: one page as stored (morning_pages.core, .note). Source marks ("channel 2:40") are not in
 * the stored text; they used to be drawn from `sources`. Nothing has to be cut out of the text.
 *
 * Paragraph number (0-based, one count over the whole page, in reading order):
 *   1. core, article format (any core item has `para`): one paragraph per distinct `para` (missing
 *      = 1), ascending. Otherwise one paragraph per core item, in order.
 *   2. then the note: sections in order, each section's paragraphs in order. A heading is no
 *      paragraph and takes no number.
 * Sentence number (0-based inside its paragraph):
 *   - article core: one core item is one sentence (never split, even if it holds several).
 *   - every other text (note paragraph, core item without `para`) is split, see below.
 * Id: `p<paragraph>.s<sentence>`.
 *
 * Split (text trimmed, whitespace runs read as one space):
 *   A sentence ends after a run of . ! ? … (one or more), plus any closing marks " ' ” ’ ) ] 」 』
 *   straight after it, when whitespace or the end of the text follows. It does not end there when
 *   - a double quote opened before the run is still open after the closing marks
 *     (“ opens and ” closes; a straight " opens and closes in turn), or
 *   - the run is one "." and the word before it is digits only ("2. ") or one of ABBREVIATIONS, or
 *   - a closing mark was read and the text goes on with a quoting ending (QUOTE_TAIL: 라고, 라는,
 *     라며, 라면서, 이라고, 이라는, 이라며, 하고).
 *   The rest without an end mark is the last sentence. Joined with one space they give the text.
 *
 * Sources: an article core item's own. A split text's sources are stored for the whole text, so
 * every sentence of it carries all of them (scope 'paragraph'; a text of one sentence is scope
 * 'sentence'). Order as stored; the same video at the same second once.
 */

export interface SentenceSource {
  video_id: string;
  t: number;
}

export interface BriefSentence {
  id: string;
  text: string;
  sources: SentenceSource[];
  /** 'paragraph' = the sources are known for the whole paragraph only, not for this sentence. */
  scope: 'sentence' | 'paragraph';
}

export interface BriefParagraph {
  /** Paragraph number over the whole page. */
  index: number;
  sentences: BriefSentence[];
  /** Different videos behind the paragraph. */
  videoCount: number;
}

export interface BriefText {
  core: BriefParagraph[];
  note: Array<{ heading: string; paragraphs: BriefParagraph[] }>;
}

const END_MARKS = '.!?…';
const CLOSERS = '"\'”’)]」』';
const ABBREVIATIONS: ReadonlySet<string> = new Set([
  'vs', 'Dr', 'Mr', 'Mrs', 'Ms', 'No', 'St', 'Jr', 'Sr', 'etc', 'e.g', 'i.e', 'U.S',
]); // prettier-ignore
const QUOTE_TAIL = /^(?:이?라(?:고|는|며|면서)|하고)/;
const DIGITS = /^\d+$/;
const SPACE = /\s/;

/** Splits one text into sentences by the rule above. */
export function splitSentences(text: string): string[] {
  const t = text.trim().replace(/\s+/g, ' ');
  const out: string[] = [];
  let start = 0;
  let curly = 0;
  let straight = false;
  const quote = (c: string): void => {
    if (c === '“') curly += 1;
    else if (c === '”') curly = Math.max(0, curly - 1);
    else if (c === '"') straight = !straight;
  };
  let i = 0;
  while (i < t.length) {
    const c = t[i]!;
    if (!END_MARKS.includes(c)) {
      quote(c);
      i += 1;
      continue;
    }
    const runStart = i;
    while (i < t.length && END_MARKS.includes(t[i]!)) i += 1;
    const run = t.slice(runStart, i);
    const closeStart = i;
    while (i < t.length && CLOSERS.includes(t[i]!)) {
      quote(t[i]!);
      i += 1;
    }
    const closed = i > closeStart;
    if (i < t.length && !SPACE.test(t[i]!)) continue;
    if (curly > 0 || straight) continue;
    if (run === '.' && !closed) {
      const word = t.slice(start, runStart).split(' ').pop() ?? '';
      if (DIGITS.test(word) || ABBREVIATIONS.has(word)) continue;
    }
    if (closed && QUOTE_TAIL.test(t.slice(i).trimStart())) continue;
    out.push(t.slice(start, i));
    while (i < t.length && SPACE.test(t[i]!)) i += 1;
    start = i;
  }
  if (start < t.length) out.push(t.slice(start));
  return out;
}

function distinct(sources: readonly SentenceSource[]): SentenceSource[] {
  const seen = new Set<string>();
  return sources.filter((s) => {
    const key = s.video_id + '|' + s.t;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

type Piece = { text: string; sources: readonly SentenceSource[]; scope: BriefSentence['scope'] };

function paragraph(index: number, pieces: readonly Piece[]): BriefParagraph {
  return {
    index,
    sentences: pieces.map((x, k) => ({
      id: `p${index}.s${k}`,
      text: x.text,
      sources: distinct(x.sources),
      scope: x.scope,
    })),
    videoCount: new Set(pieces.flatMap((x) => x.sources.map((s) => s.video_id))).size,
  };
}

function piecesOf(q: { text: string; sources: readonly SentenceSource[] }): Piece[] {
  const parts = splitSentences(q.text);
  const scope = parts.length > 1 ? 'paragraph' : 'sentence';
  return parts.map((text) => ({ text, sources: q.sources, scope }));
}

/** The page's text as numbered paragraphs and sentences. */
export function briefText(page: Pick<MorningPage, 'core' | 'note'>): BriefText {
  let n = 0;
  let core: BriefParagraph[];
  if (page.core.some((c) => c.para !== undefined)) {
    const byPara = new Map<number, Piece[]>();
    for (const c of page.core) {
      const list = byPara.get(c.para ?? 1) ?? [];
      list.push({ text: c.text.trim(), sources: c.sources, scope: 'sentence' });
      byPara.set(c.para ?? 1, list);
    }
    core = [...byPara.keys()].sort((a, b) => a - b).map((k) => paragraph(n++, byPara.get(k)!));
  } else {
    core = page.core.map((c) => paragraph(n++, piecesOf(c)));
  }
  return {
    core,
    note: page.note.map((s) => ({
      heading: s.heading,
      paragraphs: s.paragraphs.map((q) => paragraph(n++, piecesOf(q))),
    })),
  };
}

/** Every sentence of the page, in reading order. */
export function briefSentences(page: Pick<MorningPage, 'core' | 'note'>): BriefSentence[] {
  const t = briefText(page);
  return [...t.core, ...t.note.flatMap((s) => s.paragraphs)].flatMap((p) => p.sentences);
}

export interface UsedPart {
  sentenceId: string;
  /** The sentence; where the source is the whole paragraph's, the note section's heading. */
  text: string;
  t: number;
}

/** Where the page uses a video: the sentence and the second, in reading order. */
export function usedParts(page: Pick<MorningPage, 'core' | 'note'>, videoId: string): UsedPart[] {
  const t = briefText(page);
  const all = [
    ...t.core.map((p) => ({ p, heading: '' })),
    ...t.note.flatMap((s) => s.paragraphs.map((p) => ({ p, heading: s.heading }))),
  ];
  return all.flatMap(({ p, heading }) => {
    const seen = new Set<number>();
    return p.sentences.flatMap((s) =>
      s.sources.flatMap((x) => {
        // a paragraph's source is listed once
        if (x.video_id !== videoId || (s.scope === 'paragraph' && seen.has(x.t))) return [];
        seen.add(x.t);
        const text = (s.scope === 'paragraph' && heading) || s.text;
        return [{ sentenceId: s.id, text, t: x.t }];
      })
    );
  });
}
