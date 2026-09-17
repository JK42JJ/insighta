/**
 * Publish gates for newsletter v2.1 (design §4 W7 hard, W8 soft).
 *
 * Gates are declared as rows in nl_gate_spec; this module implements them
 * over an in-memory snapshot of an issue so they can run in tests, in the
 * worker, and in Admin with the same result. A gate that is declared but
 * has no implementation or was not run is reported as failed: silence is
 * not a pass.
 */
import { gradeClaim, type AtomicClaimRow, type EvidenceRow, type Grade } from './grade';

export type Severity = 'block' | 'warn';
export type ClaimType = 'fact' | 'explain' | 'transition' | 'judgment';

export interface ClaimRow {
  id: string;
  section: string;
  seq: number;
  ctype: ClaimType;
  text: string;
  /** The grade the author or a previous run put on the sentence; the gate recomputes it. */
  grade?: Grade | null;
  atomics: AtomicClaimRow[];
}

export interface PickRow {
  videoId: string;
  title: string;
  channel: string;
  views: number;
}

export interface IssueSnapshot {
  title: string;
  claims: ClaimRow[];
  /** Video ids that have a caption row; story evidence may only cite these. */
  captionedVideoIds: Set<string>;
  picks: PickRow[];
  /** The same picks as the database holds them, for picks-match-db. */
  picksInDb?: PickRow[];
  /** Rendered body, after footnotes were generated (footnotes-contiguous, no-raw-markers). */
  renderedBody?: string;
  signature?: string;
  /** Persona §3 list plus patterns promoted from nl_rejection. */
  bannedPhrases?: string[];
}

export interface GateResult {
  gate: string;
  severity: Severity;
  passed: boolean;
  detail: Record<string, unknown>;
}

const STORY_SECTIONS = new Set(['story', 'lead']);
const RAW_MARKER =
  /\[(영상|확인|관측|미확인)\]|`[A-Za-z0-9_-]{11}`|(?<![\w/])[A-Za-z0-9_-]{11}(?=[)\s]|$)/;
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
const REQUIRED_SIGNATURE = 'Insighta 에디토리얼';

function claimGrade(c: ClaimRow): Grade {
  return gradeClaim(c.atomics);
}

function evidenceOf(c: ClaimRow): EvidenceRow[] {
  return c.atomics.flatMap((a) => a.evidence);
}

export const HARD_GATES: Record<string, (s: IssueSnapshot) => GateResult> = {
  'fact-has-evidence': (s) => {
    const bad = s.claims.filter(
      (c) =>
        c.ctype === 'fact' &&
        (c.atomics.length === 0 || c.atomics.some((a) => a.evidence.length === 0))
    );
    return {
      gate: 'fact-has-evidence',
      severity: 'block',
      passed: bad.length === 0,
      detail: { claims: bad.map((c) => c.id) },
    };
  },
  'grade-rules-pass': (s) => {
    const bad = s.claims
      .filter((c) => c.ctype === 'fact' && claimGrade(c) === '미확인')
      .map((c) => ({ id: c.id, text: c.text }));
    return {
      gate: 'grade-rules-pass',
      severity: 'block',
      passed: bad.length === 0,
      detail: { unverified: bad },
    };
  },
  'story-no-captionless-evidence': (s) => {
    const bad: string[] = [];
    for (const c of s.claims) {
      if (!STORY_SECTIONS.has(c.section)) continue;
      for (const e of evidenceOf(c)) {
        if (e.kind === 'caption' || e.kind === 'primary') continue;
        if (e.videoId && !s.captionedVideoIds.has(e.videoId)) bad.push(`${c.id}:${e.videoId}`);
      }
    }
    return {
      gate: 'story-no-captionless-evidence',
      severity: 'block',
      passed: bad.length === 0,
      detail: { citations: bad },
    };
  },
  'confirmed-primary-2xx': (s) => {
    const bad = s.claims
      .filter((c) => c.ctype === 'fact' && (c.grade === '확인' || claimGrade(c) === '확인'))
      .filter(
        (c) =>
          !evidenceOf(c).some(
            (e) =>
              e.kind === 'primary' &&
              (e.httpStatus ?? 0) >= 200 &&
              (e.httpStatus ?? 0) < 300 &&
              !!e.fetchedAt
          )
      )
      .map((c) => c.id);
    return {
      gate: 'confirmed-primary-2xx',
      severity: 'block',
      passed: bad.length === 0,
      detail: { claims: bad },
    };
  },
  'no-raw-markers': (s) => {
    const hits = s.claims
      .filter((c) => RAW_MARKER.test(c.text))
      .map((c) => ({ id: c.id, text: c.text }));
    const rendered = s.renderedBody
      ? (s.renderedBody.match(/\[(영상|확인|관측|미확인)\]/g) ?? [])
      : [];
    return {
      gate: 'no-raw-markers',
      severity: 'block',
      passed: hits.length === 0 && rendered.length === 0,
      detail: { claims: hits, rendered },
    };
  },
  'no-editorial-vocab-emoji': (s) => {
    const texts = [s.title, ...s.claims.map((c) => c.text), s.renderedBody ?? ''];
    const problems: string[] = [];
    if (texts.some((t) => /편집부/.test(t))) problems.push('편집부');
    if (texts.some((t) => EMOJI.test(t))) problems.push('emoji');
    if (s.signature !== undefined && s.signature !== REQUIRED_SIGNATURE)
      problems.push(`signature=${s.signature}`);
    return {
      gate: 'no-editorial-vocab-emoji',
      severity: 'block',
      passed: problems.length === 0,
      detail: { problems },
    };
  },
  'picks-match-db': (s) => {
    if (!s.picksInDb)
      return {
        gate: 'picks-match-db',
        severity: 'block',
        passed: false,
        detail: { reason: 'db picks not supplied' },
      };
    const byId = new Map(s.picksInDb.map((p) => [p.videoId, p]));
    const bad = s.picks
      .filter((p) => {
        const d = byId.get(p.videoId);
        return !d || d.title !== p.title || d.channel !== p.channel || d.views !== p.views;
      })
      .map((p) => p.videoId);
    return {
      gate: 'picks-match-db',
      severity: 'block',
      passed: bad.length === 0 && s.picks.length === 5,
      detail: { mismatched: bad, count: s.picks.length },
    };
  },
  'footnotes-contiguous': (s) => {
    if (s.renderedBody === undefined)
      return {
        gate: 'footnotes-contiguous',
        severity: 'block',
        passed: false,
        detail: { reason: 'not rendered' },
      };
    const nums = Array.from(s.renderedBody.matchAll(/\[\^?(\d+)\]/g), (m) => Number(m[1]));
    const uniq = Array.from(new Set(nums)).sort((a, b) => a - b);
    const contiguous = uniq.every((n, i) => n === i + 1);
    return {
      gate: 'footnotes-contiguous',
      severity: 'block',
      passed: contiguous,
      detail: { seen: uniq },
    };
  },
};

const DEFAULT_BANNED = [
  '더는 아니다',
  '주목할 만하다',
  '결국 핵심은',
  '시사하는 바가 크다',
  '할 필요가 있다',
  '우리는 이제',
  '단순한',
  '그 어느 때보다',
  '~에 대한',
  '에 의해',
  '되어지는',
];

export const SOFT_GATES: Record<string, (s: IssueSnapshot) => GateResult> = {
  'banned-phrases': (s) => {
    const banned = [...DEFAULT_BANNED, ...(s.bannedPhrases ?? [])];
    const hits = s.claims.flatMap((c) =>
      banned.filter((b) => c.text.includes(b)).map((b) => ({ id: c.id, phrase: b }))
    );
    return {
      gate: 'banned-phrases',
      severity: 'warn',
      passed: hits.length === 0,
      detail: { hits },
    };
  },
  'title-shape': (s) => {
    const dash = /[—–]/.test(s.title);
    const nounPhrase = !/(다|요|까|니다|습니다)[.!?]?$/.test(s.title.trim());
    return {
      gate: 'title-shape',
      severity: 'warn',
      passed: !dash && !nounPhrase,
      detail: { dash, nounPhrase },
    };
  },
  'judgment-count': (s) => {
    const n = s.claims.filter((c) => c.ctype === 'judgment').length;
    return { gate: 'judgment-count', severity: 'warn', passed: n <= 3, detail: { judgments: n } };
  },
  'sentence-length-variance': (s) => {
    const runs: string[] = [];
    let streak = 0;
    for (const c of s.claims) {
      if (c.text.length <= 18 && /다\.?$/.test(c.text.trim())) {
        streak += 1;
        if (streak >= 3) runs.push(c.id);
      } else streak = 0;
    }
    return {
      gate: 'sentence-length-variance',
      severity: 'warn',
      passed: runs.length === 0,
      detail: { runs },
    };
  },
};

/**
 * Run every declared gate. `declared` comes from nl_gate_spec; a declared gate
 * without an implementation is a failed result, so a new spec row cannot be
 * satisfied by forgetting to write it.
 */
export function runGates(
  declared: Array<{ name: string; severity: Severity }>,
  snapshot: IssueSnapshot
): GateResult[] {
  return declared.map(({ name, severity }) => {
    const impl = severity === 'block' ? HARD_GATES[name] : SOFT_GATES[name];
    if (!impl)
      return { gate: name, severity, passed: false, detail: { reason: 'not implemented' } };
    return impl(snapshot);
  });
}

/** Publish is allowed only when every declared block gate has a result and it passed. */
export function publishAllowed(
  declared: Array<{ name: string; severity: Severity }>,
  results: GateResult[]
): { allowed: boolean; blocking: string[] } {
  const blocking: string[] = [];
  for (const d of declared) {
    if (d.severity !== 'block') continue;
    const r = results.find((x) => x.gate === d.name);
    if (!r || !r.passed) blocking.push(d.name);
  }
  return { allowed: blocking.length === 0, blocking };
}
