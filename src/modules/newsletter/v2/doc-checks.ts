/**
 * Checks that read a finished issue against the materials it was built from.
 *
 * The publish gates answer "is this document well formed". These answer "does
 * it say anything the materials do not". Issue 2 passed every gate the project
 * had and still carried a pool size that no source stated, a video cited in
 * the body and absent from the source list, and a summary that counted its own
 * citations differently from the editor's note. A reviewer caught all three by
 * hand across five rounds.
 *
 * Everything here is a pure function over text. No model, no network, so the
 * whole set runs in a unit test and on every draft.
 */

import type { IssueDocument, Block } from '../issue-schema';

export interface Materials {
  /** Every number the sources actually stated, as written. */
  factsText: string;
  /** Stage counts from the run ledger, keyed by bucket. */
  funnelBuckets: Array<{ key: string; count: number }>;
}

export interface DocFinding {
  check: string;
  where: string;
  detail: string;
}

/** A derived number the issue declares, so a checker can recompute it. */
export interface Calculation {
  label: string;
  /** Each input with the unit it is written in. A bare number cannot be checked. */
  inputs: Record<string, number>;
  /** Unit per input name, where the input carries one: `{ kv: 'GiB', weights: 'GB' }`. */
  inputUnits?: Record<string, string>;
  formula: string;
  result: number;
  unit?: string;
  rounding?: 'floor' | 'ceil' | 'round' | 'none';
  /**
   * What the number is, in the words the issue uses for it. Checked against the
   * sentence that prints it: issue 2 called a ratio of fill rates "the share of
   * seats thrown away", and those are different quantities -- 1.24 against 125.
   */
  label_means?: string;
  /**
   * The range the formula was checked over, when the issue states the result as
   * a rule rather than one reading. "Past the boundary half the card empties"
   * holds at one boundary out of four; the others waste a third and a quarter.
   */
  domain?: { variable: string; from: number; to: number };
}

const YOUTUBE_ID = /\b[A-Za-z0-9_-]{11}\b/g;

function blockText(b: Block): string {
  if (b.type === 'table') return [...b.head, ...b.rows.flat()].join(' ');
  if (b.type === 'h3') return b.text;
  if (b.type === 'note') return `${b.lead} ${b.html}`;
  return b.html;
}

/** Body prose and tables, tags stripped. */
export function bodyText(doc: IssueDocument): string {
  const parts: string[] = [];
  for (const s of doc.stories) {
    parts.push(s.title);
    for (const b of s.blocks) parts.push(blockText(b));
  }
  for (const b of doc.insight.blocks) parts.push(blockText(b));
  return parts.join('\n').replace(/<[^>]+>/g, ' ');
}

/**
 * Numbers as the reader meets them: digits with separators and an optional
 * decimal. Percentages and units stay attached to the token that follows so a
 * caller can tell 16GiB from 16GB.
 */
export function numbersIn(text: string): string[] {
  return (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, ''));
}

/**
 * Every number in the body must appear in the materials or be declared as a
 * calculation. A number that is in neither came from somewhere this issue
 * cannot point at.
 *
 * Years, single digits and ordinals are exempt: they are prose, not claims,
 * and flagging them buries the real findings.
 */
export function checkNumbersGrounded(
  doc: IssueDocument,
  materials: Materials,
  calculations: Calculation[] = []
): DocFinding[] {
  const known = new Set(numbersIn(materials.factsText));
  for (const b of materials.funnelBuckets) known.add(String(b.count));
  for (const c of calculations) {
    known.add(String(c.result));
    for (const v of Object.values(c.inputs)) known.add(String(v));
  }
  for (const row of doc.interest.ledger) for (const n of numbersIn(row.value)) known.add(n);

  const findings: DocFinding[] = [];
  const seen = new Set<string>();
  for (const n of numbersIn(bodyText(doc))) {
    const v = Number(n);
    if (!Number.isFinite(v)) continue;
    if (v < 10) continue; // "세 명", "네 번" — prose
    if (v >= 1900 && v <= 2100 && !n.includes('.')) continue; // years
    if (known.has(n) || seen.has(n)) continue;
    seen.add(n);
    findings.push({
      check: 'number-grounded',
      where: 'body',
      detail: `${n} appears in no source and is not declared as a calculation`,
    });
  }
  return findings;
}

/**
 * A four-function calculator over the declared inputs.
 *
 * Written out rather than handed to `new Function`: a formula is editorial
 * text, and the day someone pastes one from a draft is the day an eval becomes
 * a code path with an author outside the repository. Supports + - * / and
 * parentheses, which is every derivation a brief has needed.
 */
export function evaluateFormula(formula: string, vars: Record<string, number>): number {
  const tokens = formula.match(/[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?|[-+*/()]/g);
  if (!tokens) throw new Error(`empty formula: ${formula}`);
  let i = 0;
  const peek = (): string | undefined => tokens[i];

  const primary = (): number => {
    const t = tokens[i++];
    if (t === undefined) throw new Error(`formula ends early: ${formula}`);
    if (t === '(') {
      const v = expr();
      if (tokens[i++] !== ')') throw new Error(`unbalanced parentheses: ${formula}`);
      return v;
    }
    if (t === '-') return -primary();
    if (/^[A-Za-z_]/.test(t)) {
      const v = vars[t];
      if (v === undefined) throw new Error(`formula uses ${t}, which is not a declared input`);
      return v;
    }
    return Number(t);
  };

  const term = (): number => {
    let v = primary();
    for (;;) {
      const op = peek();
      if (op !== '*' && op !== '/') return v;
      i++;
      const r = primary();
      v = op === '*' ? v * r : v / r;
    }
  };

  function expr(): number {
    let v = term();
    for (;;) {
      const op = peek();
      if (op !== '+' && op !== '-') return v;
      i++;
      const r = term();
      v = op === '+' ? v + r : v - r;
    }
  }

  const value = expr();
  if (i !== tokens.length) throw new Error(`trailing tokens in formula: ${formula}`);
  return value;
}

/** Recompute every declared calculation and compare with what the issue printed. */
export function checkCalculations(calculations: Calculation[]): DocFinding[] {
  const findings: DocFinding[] = [];
  for (const c of calculations) {
    let got: number;
    try {
      got = evaluateFormula(c.formula, c.inputs);
    } catch (err) {
      findings.push({
        check: 'calculation',
        where: c.label,
        detail: `formula failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }
    const rounded =
      c.rounding === 'floor'
        ? Math.floor(got)
        : c.rounding === 'ceil'
          ? Math.ceil(got)
          : c.rounding === 'round'
            ? Math.round(got)
            : got;
    if (Math.abs(rounded - c.result) > 1e-9) {
      findings.push({
        check: 'calculation',
        where: c.label,
        detail: `${c.formula} = ${rounded}, issue prints ${c.result}`,
      });
    }
    // An undeclared rounding needs no second check: with `rounding` absent the
    // recomputed value keeps its fraction, so the comparison above already
    // fails with "318.5, issue prints 318" — which is the finding. Warning
    // again when the rounding IS declared would punish the issue for saying so.
  }
  return findings;
}

/**
 * Adding GiB to GB is a bug the arithmetic cannot see.
 *
 * 16 GiB is 17.18 GB. An issue that adds them and prints the sum in one of the
 * two is out by 1.18 GB, which in issue 2 was a third of the margin the whole
 * story turned on. The recompute check passes it: the numbers add up, they are
 * just not the same kind of number.
 */
const BINARY_UNIT = /^(Ki|Mi|Gi|Ti)B$/;
const DECIMAL_UNIT = /^(K|M|G|T)?B$/;

export function checkUnitsConsistent(calculations: Calculation[]): DocFinding[] {
  const findings: DocFinding[] = [];
  for (const c of calculations) {
    const units = Object.entries(c.inputUnits ?? {});
    // Only additive formulas are checked. A division that mixes units is often
    // exactly the point -- bytes per token, tokens per second.
    const additive = /[+-]/.test(c.formula) && !/[*/]/.test(c.formula);
    if (!additive || units.length < 2) continue;

    const binary = units.filter(([, u]) => BINARY_UNIT.test(u));
    const decimal = units.filter(([, u]) => DECIMAL_UNIT.test(u) && !BINARY_UNIT.test(u));
    if (binary.length > 0 && decimal.length > 0) {
      findings.push({
        check: 'unit-mixed',
        where: c.label,
        detail:
          `adds ${binary.map(([k, u]) => `${k} in ${u}`).join(', ')} to ` +
          `${decimal.map(([k, u]) => `${k} in ${u}`).join(', ')} — convert before adding`,
      });
    }
    if (c.unit && !units.some(([, u]) => u === c.unit)) {
      findings.push({
        check: 'unit-result',
        where: c.label,
        detail: `result is stated in ${c.unit}, which no input uses`,
      });
    }
  }
  return findings;
}

/**
 * A number's name has to match what was computed.
 *
 * Issue 2 computed the ratio of two fill rates, 1.24, and called it the share
 * of seats thrown away. That quantity is 125 — a hundred times off, under a
 * name a reader would take at face value. The check is a word test, not a
 * numeric one: it looks for the issue calling a ratio a waste or a share.
 */
export function checkCalculationLabels(
  calculations: Calculation[],
  doc: IssueDocument
): DocFinding[] {
  const findings: DocFinding[] = [];
  const text = bodyText(doc) + JSON.stringify(doc.interest.ledger);
  for (const c of calculations) {
    if (!c.label_means) continue;
    const near = new RegExp(`[^.。]{0,80}${c.result}배[^.。]{0,80}`, 'g');
    for (const m of text.match(near) ?? []) {
      const saysWaste = /버려지|낭비|버린/.test(m);
      const meansWaste = /버려지|낭비|버린/.test(c.label_means);
      if (saysWaste !== meansWaste)
        findings.push({
          check: 'calculation-label',
          where: c.label,
          detail: `computed as "${c.label_means}" but the text around ${c.result}배 names it differently`,
        });
    }
  }
  return findings;
}

/**
 * A result stated as a rule has to hold across the range, not at one reading.
 *
 * "Past the boundary half the card empties" is true at one of four boundaries.
 * At the others a third empties, or a quarter. A calculation that declares a
 * domain gets swept; one that does not is a single reading and the issue has
 * to print it as one.
 */
export function checkCalculationDomain(calculations: Calculation[]): DocFinding[] {
  const findings: DocFinding[] = [];
  for (const c of calculations) {
    if (!c.domain) continue;
    const { variable, from, to } = c.domain;
    const steps = 200;
    let matches = 0;
    let sampled = 0;
    for (let i = 0; i <= steps; i++) {
      const x = from + ((to - from) * i) / steps;
      let got: number;
      try {
        got = evaluateFormula(c.formula, { ...c.inputs, [variable]: x });
      } catch {
        continue;
      }
      sampled++;
      if (Math.abs(got - c.result) < 1e-6) matches++;
    }
    if (sampled > 0 && matches < sampled) {
      findings.push({
        check: 'calculation-domain',
        where: c.label,
        detail:
          `${c.result} holds at ${matches} of ${sampled} points over ${variable} ` +
          `${from}..${to} — state it as one reading, not a rule`,
      });
    }
  }
  return findings;
}

/** Every video id in the body has to be in the source list or the picks. */
export function checkCitationsListed(doc: IssueDocument): DocFinding[] {
  const listed = new Set<string>();
  for (const r of doc.refs)
    for (const s of r.sources) {
      const m = /v=([A-Za-z0-9_-]{11})/.exec(s.url ?? '');
      if (m?.[1]) listed.add(m[1]);
    }
  for (const p of doc.picks) if (p.videoId) listed.add(p.videoId);

  const findings: DocFinding[] = [];
  const text = bodyText(doc);
  for (const id of new Set(text.match(YOUTUBE_ID) ?? [])) {
    if (!/[-_]/.test(id) && !/[A-Z]/.test(id)) continue; // plain words are not ids
    if (!listed.has(id))
      findings.push({
        check: 'citation-listed',
        where: id,
        detail: 'cited in the body, absent from refs and picks',
      });
  }
  return findings;
}

/** An issue cannot be its own source. */
export function checkNoSelfCitation(doc: IssueDocument): DocFinding[] {
  const findings: DocFinding[] = [];
  for (const r of doc.refs)
    for (const s of r.sources)
      if ((s.url ?? '').includes(`/brief/${doc.slug}`) || (s.url ?? '').includes(`/${doc.slug}`))
        findings.push({ check: 'self-citation', where: r.label, detail: `${s.url} is this issue` });
  return findings;
}

/**
 * `verified` means a primary source was opened. A YouTube link is the video
 * that made the claim, not a source that confirms it.
 */
export function checkVerifiedHasPrimary(doc: IssueDocument): DocFinding[] {
  const findings: DocFinding[] = [];
  for (const row of doc.interest.ledger) {
    if (row.grade !== 'verified' || row.ref === undefined) continue;
    const group = doc.refs[row.ref - 1];
    if (!group) continue;
    const anyPrimary = group.sources.some((s) => s.url && !/youtube\.com|youtu\.be/.test(s.url));
    if (!anyPrimary)
      findings.push({
        check: 'verified-needs-primary',
        where: row.name,
        detail: 'graded verified but every source under it is a video',
      });
  }
  return findings;
}

/** Counts the issue states about itself have to match what it contains. */
export function checkSelfCounts(doc: IssueDocument): DocFinding[] {
  const listed = new Set<string>();
  for (const r of doc.refs)
    for (const s of r.sources) {
      const m = /v=([A-Za-z0-9_-]{11})/.exec(s.url ?? '');
      if (m?.[1]) listed.add(m[1]);
    }
  for (const p of doc.picks) if (p.videoId) listed.add(p.videoId);

  const findings: DocFinding[] = [];
  const meta = `${doc.runline} ${doc.editNote} ${doc.dek}`;
  for (const m of meta.matchAll(/(\d+)\s*편/g)) {
    const n = Number(m[1]);
    if (n === listed.size) continue;
    if (n > 200) continue; // corpus counts, not citation counts
    findings.push({
      check: 'self-count',
      where: m[0],
      detail: `says ${n}편 but the issue carries ${listed.size} distinct videos`,
    });
  }
  return findings;
}

/** A pointer into the next-issue list has to land on an item that exists. */
export function checkCrossReferences(doc: IssueDocument): DocFinding[] {
  const n = doc.next.checkpoints.length;
  const findings: DocFinding[] = [];
  const ORDINALS = ['첫', '두', '세', '네', '다섯', '여섯', '일곱', '여덟', '아홉', '열'];
  for (const b of doc.insight.blocks) {
    const t = blockText(b);
    for (const m of t.matchAll(/([첫두세네다섯여섯일곱여덟아홉열]+)\s*번째\s*항목/g)) {
      const idx = ORDINALS.indexOf(m[1] ?? '') + 1;
      if (idx > 0 && idx > n)
        findings.push({
          check: 'cross-reference',
          where: m[0],
          detail: `points at item ${idx}; the next-issue list has ${n}`,
        });
    }
  }
  return findings;
}

/** Everything above, in one call. */
export function runDocumentChecks(
  doc: IssueDocument,
  materials: Materials,
  calculations: Calculation[] = [],
  sentences: GroundedSentence[] = []
): DocFinding[] {
  return [
    ...checkNumbersGrounded(doc, materials, calculations),
    ...checkCalculations(calculations),
    ...checkUnitsConsistent(calculations),
    ...checkCalculationLabels(calculations, doc),
    ...checkCalculationDomain(calculations),
    ...checkGroundingQuotes(sentences),
    ...checkQuoteCarriesFigures(sentences),
    ...checkAttributionQuoted(sentences),
    ...checkCitationsListed(doc),
    ...checkNoSelfCitation(doc),
    ...checkVerifiedHasPrimary(doc),
    ...checkSelfCounts(doc),
    ...checkCrossReferences(doc),
  ];
}

/**
 * A sentence in the issue, paired with the source text it leans on.
 *
 * `quoted` is the verbatim run from the source that justifies the sentence --
 * `nl_evidence.quoted` in the v2.1 model. The check below is one `includes`,
 * and it is the cheapest honest thing this pipeline can do: a sentence whose
 * quote is not in its source is either paraphrased past what the source says
 * or invented outright, and both read the same from the outside.
 */
export interface GroundedSentence {
  /** Where it sits, for the finding. */
  where: string;
  /** The sentence as the issue prints it. */
  text: string;
  /** Verbatim run from the source, as the source wrote it. */
  quoted: string;
  /** The source text the quote should be found in. */
  sourceText: string;
}

/**
 * Compare the way a reader would, not the way a byte comparator would.
 *
 * NFC because macOS hands back decomposed Hangul and Postgres stores composed:
 * the same title read from the Mac Mini's cache and from the database look
 * identical on screen and differ byte for byte. Whitespace collapses because a
 * caption line break is not a difference in what was said.
 */
function forComparison(s: string): string {
  return s.normalize('NFC').replace(/\s+/g, ' ').trim();
}

/** A quote that is not in its source did not come from it. */
export function checkGroundingQuotes(sentences: GroundedSentence[]): DocFinding[] {
  const findings: DocFinding[] = [];
  for (const s of sentences) {
    const quote = forComparison(s.quoted);
    if (quote.length === 0) {
      findings.push({
        check: 'grounding-quote',
        where: s.where,
        detail: 'no quote for a sentence that needs one',
      });
      continue;
    }
    if (!forComparison(s.sourceText).includes(quote)) {
      findings.push({
        check: 'grounding-quote',
        where: s.where,
        detail: `the quote is not in the source: "${s.quoted.slice(0, 60)}"`,
      });
    }
  }
  return findings;
}

/**
 * Numbers and proper nouns in a sentence have to be in the quote that backs it.
 *
 * The quote check alone passes a sentence that keeps a real quote and changes a
 * figure beside it. Issue 1 shipped two dates that way -- reported 8/23 where
 * the source said 8/16, published 7/24 where it said 7/2 -- and both sat under
 * a 확인 badge. This compares the tokens, so a changed digit is a finding even
 * when every other word is verbatim.
 */
export function checkQuoteCarriesFigures(sentences: GroundedSentence[]): DocFinding[] {
  const findings: DocFinding[] = [];
  for (const s of sentences) {
    const inQuote = new Set(numbersIn(s.quoted));
    for (const n of numbersIn(s.text)) {
      const v = Number(n);
      if (!Number.isFinite(v) || v < 10) continue;
      if (!inQuote.has(n))
        findings.push({
          check: 'figure-not-in-quote',
          where: s.where,
          detail: `the sentence says ${n}; the quote backing it does not`,
        });
    }
  }
  return findings;
}

/**
 * An issue may not put words in a source's mouth.
 *
 * Reported-speech forms -- `~다던`, `~라고 했다`, `~라고 불렀다` -- assert that
 * someone said a thing. When the quote does not carry it, the issue has
 * invented an attribution. Issue 2 did this three times in a row at the same
 * sentence: each round the wording softened and the attribution stayed, and it
 * closed only when the clause was deleted rather than rewritten.
 */
const REPORTED_SPEECH = /(다던|라고 (했|불렀|적었|말했)|고 밝혔|라고 주장)/;

/**
 * What is being put in the source's mouth.
 *
 * In `이 파일을 4비트라고 불렀습니다` the reported content is `4비트`: the run
 * immediately before the quotative particle. Crude, and it has to be — the
 * alternative is a model deciding whether a paraphrase is fair, and this
 * pipeline does not let a model near that question.
 */
function reportedContent(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/([^\s,.。]{1,20})\s*(?:라고|다던)/g)) if (m[1]) out.push(m[1]);
  return out;
}

export function checkAttributionQuoted(sentences: GroundedSentence[]): DocFinding[] {
  const findings: DocFinding[] = [];
  for (const s of sentences) {
    if (!REPORTED_SPEECH.test(s.text)) continue;
    const quote = forComparison(s.quoted);
    if (quote.length === 0) {
      findings.push({
        check: 'attribution-unquoted',
        where: s.where,
        detail: 'reports what a source said, with no quote to show it said so',
      });
      continue;
    }
    // A quote that is present but about something else is the harder case, and
    // the one issue 2 kept producing: the sentence softened each round and the
    // attribution survived. The reported content has to be in the quote.
    for (const term of reportedContent(s.text)) {
      if (!quote.includes(forComparison(term)))
        findings.push({
          check: 'attribution-unquoted',
          where: s.where,
          detail: `says the source called it "${term}"; the quote does not contain that`,
        });
    }
  }
  return findings;
}
