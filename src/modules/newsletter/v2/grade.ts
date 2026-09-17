/**
 * Grade rules for newsletter v2.1 claims (design §3.4).
 *
 * A grade belongs to a sentence and is computed from the evidence its atomic
 * claims carry. Nothing here calls a model: the rules are the same ones a
 * reviewer applied by hand on the first issue, written down so the second
 * issue cannot skip them.
 *
 *   확인   a primary source was fetched and its excerpt carries the number or
 *          name the atomic claim asserts
 *   관측   only caption or description evidence, and the number agrees across
 *          the sources that mention it (approximations allowed); a proper
 *          noun needs a description or primary source, captions alone do not
 *          count (auto captions misspell 45% of names)
 *   미확인 the sources disagree, or the value appears in one source only; a
 *          fact sentence cannot be stored with this grade
 */

export type EvidenceKind = 'caption' | 'description' | 'primary';
export type AtomicKind = 'number' | 'entity' | 'quote' | 'event';
export type Grade = '확인' | '관측' | '미확인';

export interface EvidenceRow {
  id: string;
  kind: EvidenceKind;
  /** The compared excerpt, at most 200 characters (design §3.2). */
  quoted: string;
  videoId?: string | null;
  /** kind=primary: the fetched URL. */
  url?: string | null;
  httpStatus?: number | null;
  fetchedAt?: string | null;
  /** Caption quality from the collector; low entity recall demotes caption evidence. */
  captionQuality?: { entity_recall?: number; speakers?: number; music?: boolean } | null;
}

export interface AtomicClaimRow {
  id: string;
  kind: AtomicKind;
  /** Decontextualized statement, readable without the sentence around it. */
  text: string;
  /** For numbers: the normalized value. For names/quotes: the string to find. */
  normalized: string;
  evidence: EvidenceRow[];
}

/** Numbers that the copy may round: "5,000달러쯤" and "$5,100" count as one observation. */
const APPROX_MARKERS = /(약|쯤|정도|대략|근처|approximately|about|around|roughly|~)/i;
/** Multiplier by the token that immediately follows the digits. "GB", "ms", "달러" are units, not multipliers. */
const MULTIPLIERS: Record<string, number> = {
  천: 1_000,
  thousand: 1_000,
  k: 1_000,
  만: 10_000,
  백만: 1_000_000,
  million: 1_000_000,
  m: 1_000_000,
  억: 100_000_000,
  십억: 1_000_000_000,
  billion: 1_000_000_000,
  b: 1_000_000_000,
};

export interface NormalizedNumber {
  value: number;
  approximate: boolean;
}

/** "62,847" → 62847; "5,000달러쯤" → 5000 (approximate); "$5.1k" → 5100. Null when no number. */
export function normalizeNumber(raw: string): NormalizedNumber | null {
  const s = raw.trim();
  const m = s.match(/-?\d[\d,]*(?:\.\d+)?/);
  if (!m) return null;
  let value = Number(m[0].replace(/,/g, ''));
  if (!Number.isFinite(value)) return null;
  const after = s.slice((m.index ?? 0) + m[0].length);
  const token = (after.match(/^\s*([A-Za-z가-힣]+)/)?.[1] ?? '').toLowerCase();
  const mult = MULTIPLIERS[token];
  if (mult) value *= mult;
  return { value, approximate: APPROX_MARKERS.test(s) };
}

/** Exact match, or within 5% when either side is written as an approximation. */
export function numbersMatch(a: string, b: string): boolean {
  const x = normalizeNumber(a);
  const y = normalizeNumber(b);
  if (!x || !y) return false;
  if (x.value === y.value) return true;
  if (!(x.approximate || y.approximate)) return false;
  const tolerance = 0.05 * Math.max(Math.abs(x.value), Math.abs(y.value));
  return Math.abs(x.value - y.value) <= tolerance;
}

const fold = (s: string): string => s.toLowerCase().replace(/[\s\-_.,'"“”‘’`]/g, '');

/** Does the evidence excerpt carry the atomic claim's value? Numbers compare numerically, text by folded containment. */
/** Identifiers such as CVE-2025-59536 or 1.0.90 are compared as text, not as quantities. */
const IDENTIFIER = /[A-Za-z]|\d-\d|\d\.\d+\.\d/;

/** Every token of the normalized value appears in the excerpt (order-free, punctuation-insensitive). */
function tokensPresent(normalized: string, quoted: string): boolean {
  const hay = fold(quoted);
  const tokens = normalized
    .split(/\s+/)
    .map(fold)
    .filter((t) => t.length > 0);
  return tokens.length > 0 && tokens.every((t) => hay.includes(t));
}

export function evidenceCarries(atomic: AtomicClaimRow, ev: EvidenceRow): boolean {
  if (atomic.kind === 'number' && !IDENTIFIER.test(atomic.normalized)) {
    const nums = ev.quoted.match(/-?\d[\d,]*(?:\.\d+)?\s*[A-Za-z가-힣]*/g) ?? [];
    return nums.some((n) => numbersMatch(atomic.normalized, n));
  }
  return tokensPresent(atomic.normalized, ev.quoted);
}

const LOW_CAPTION_QUALITY = 0.6;

function captionUsable(ev: EvidenceRow): boolean {
  const q = ev.captionQuality;
  if (!q) return true;
  if (q.music) return false;
  if ((q.speakers ?? 1) > 1) return false;
  if (q.entity_recall !== undefined && q.entity_recall < LOW_CAPTION_QUALITY) return false;
  return true;
}

/** Grade of one atomic claim from its own evidence. */
export function gradeAtomic(atomic: AtomicClaimRow): Grade {
  const primary = atomic.evidence.filter(
    (e) =>
      e.kind === 'primary' && (e.httpStatus ?? 0) >= 200 && (e.httpStatus ?? 0) < 300 && e.fetchedAt
  );
  if (primary.some((e) => evidenceCarries(atomic, e))) return '확인';

  const descriptions = atomic.evidence.filter((e) => e.kind === 'description');
  const captions = atomic.evidence.filter((e) => e.kind === 'caption' && captionUsable(e));
  const descHit = descriptions.some((e) => evidenceCarries(atomic, e));
  const capHit = captions.some((e) => evidenceCarries(atomic, e));
  const descMiss = descriptions.length > 0 && !descHit;
  const capMiss = captions.length > 0 && !capHit;

  if (atomic.kind === 'number') {
    // Both kinds present: they must agree. One kind present: it must carry the value.
    if (descriptions.length && captions.length) return descHit && capHit ? '관측' : '미확인';
    if (descHit || capHit) return descMiss || capMiss ? '미확인' : '관측';
    return '미확인';
  }
  if (atomic.kind === 'entity') {
    // Proper nouns: captions alone never count.
    if (descHit) return capMiss ? '미확인' : '관측';
    return '미확인';
  }
  // quote / event: any usable source that carries the text is an observation.
  if (descHit || capHit) return '관측';
  return '미확인';
}

/** A sentence is as weak as its weakest atomic claim. No atomic claims = nothing verified. */
export function gradeClaim(atomics: AtomicClaimRow[]): Grade {
  if (atomics.length === 0) return '미확인';
  const order: Grade[] = ['확인', '관측', '미확인'];
  let worst: Grade = '확인';
  for (const a of atomics) {
    const g = gradeAtomic(a);
    if (order.indexOf(g) > order.indexOf(worst)) worst = g;
  }
  return worst;
}
