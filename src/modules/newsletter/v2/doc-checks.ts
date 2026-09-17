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
  inputs: Record<string, number>;
  formula: string;
  result: number;
  unit?: string;
  rounding?: 'floor' | 'ceil' | 'round' | 'none';
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

/** GiB and GB are not the same unit, and an issue that adds them says so. */
export function checkUnitsConsistent(calculations: Calculation[]): DocFinding[] {
  const findings: DocFinding[] = [];
  for (const c of calculations) {
    if (!c.unit) continue;
    const binary = /iB$/.test(c.unit);
    const mixed = /\b\d+(\.\d+)?\s?(GB|MB|KB)\b/.test(c.formula) && binary;
    if (mixed)
      findings.push({
        check: 'unit-mixed',
        where: c.label,
        detail: `result is ${c.unit} but the formula carries decimal units`,
      });
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
  calculations: Calculation[] = []
): DocFinding[] {
  return [
    ...checkNumbersGrounded(doc, materials, calculations),
    ...checkCalculations(calculations),
    ...checkUnitsConsistent(calculations),
    ...checkCitationsListed(doc),
    ...checkNoSelfCitation(doc),
    ...checkVerifiedHasPrimary(doc),
    ...checkSelfCounts(doc),
    ...checkCrossReferences(doc),
  ];
}
