// Topic synthesis (ARCHITECTURE-bookindex.md §1⑤ 내용차원 재배치).
//
// Takes one cell's atom pool (atoms from MANY videos, each carrying {vid, ts,
// text}) and regroups them into content TOPICS — dissolving the video boundary
// so a section is a topic, not a video (removes defect-1: section title = video
// title). The LLM ONLY clusters + labels; it references atoms by index and code
// resolves those indices back to {vid, ts}, so provenance (and the figure /
// relevance links that travel on {vid, ts}) is preserved without fabrication.
//
// Deliberately ISOLATED from build-book (which stays a PURE function). This is
// the ONLY non-deterministic step; build-book consumes its output.
//
// Service module — OpenRouter Sonnet is a production LLM call (the deployed
// pipeline / a James-run prototype invokes it; CC must not call it for tests).
// (Header said "Haiku" pre-CP504; the model is Sonnet — see the §1⑤ note below.)

import { OpenRouterGenerationProvider } from '@/modules/llm/openrouter';
import { logger } from '@/utils/logger';
import { parseJsonLenient } from '@/utils/lenient-json';

const log = logger.child({ module: 'mandala-book/topic-synthesis' });

// §1⑤ COMPRESSION model = Sonnet (CP504: 6-model + dual-blind-judge verified;
// Sonnet preserves provenance on big notes — Haiku over-drops [17% vs 52%]).
// This is no longer "clustering" (drop-0); it is COMPRESSION (importance-select
// + abstract enumeration-clusters; low-value atoms are intentionally dropped).
const SONNET_MODEL = 'anthropic/claude-sonnet-4-6';
// Output is compressed (far fewer atom_idx listed than input) → 8000 holds even
// the largest cell comfortably. Retry guard below covers a transient truncation.
const MAX_TOKENS = 8000;
// Retried once on a parse/provider failure (transient or one-off truncation).
const SYNTHESIS_ATTEMPTS = 2;
const TEMPERATURE = 0.2;
// Section count target: "5-min core grasp" ~note-size-proportional (CP504 §4.5.0:
// 168 atoms→~14, 317→~20). ~1 section per ~12 input atoms, clamped [2, 24] so a
// huge cell still compresses to a readable book chapter, not a wall.
const ATOMS_PER_TOPIC = 12;
const MIN_TOPICS_PER_CELL = 2;
const MAX_TOPICS_CAP = 24;
function topicCapFor(atomCount: number): number {
  return Math.min(
    MAX_TOPICS_CAP,
    Math.max(MIN_TOPICS_PER_CELL, Math.ceil(atomCount / ATOMS_PER_TOPIC))
  );
}

/** One source atom (from the cell's pooled v2 atoms). */
export interface TopicAtom {
  vid: string;
  ts: number;
  text: string;
}

/** A synthesized topic-section: a content theme grouping atoms across videos. */
export interface TopicSection {
  topic_title: string; // CONTENT name (e.g. "REST API 라우팅 구조"), NOT a video title
  summary: string; // 1-2 line topic framing (light synthesis, no invented facts)
  atom_refs: Array<{ vid: string; ts: number }>; // provenance — resolved from LLM indices
  // NOTE-DENSITY ① (back-compat) — bullet take-away array. Absent until book-body weave step.
  keyPoints?: string[];
  // NOTE-DENSITY ①-v2 — 2-3 sentence prose synthesis. Populated by book-body weave step.
  keyPoint?: string;
}

/** Atoms intentionally dropped by compression (transparency — CP504 §4.5.0). */
export interface RemovedAtoms {
  compressed: number[]; // low-value / out-of-scope atoms the model dropped
  dedup: number[]; // cross-cell dedup — populated in a later phase (4.5.1)
  safety: number[]; // structural only (harmful atoms measured 0% → no pre-pass)
}

export type TopicSynthesisResult =
  | { ok: true; topics: TopicSection[]; removed: RemovedAtoms }
  | { ok: false; reason: string };

interface LlmSection {
  title?: unknown;
  content?: unknown;
  atom_idx?: unknown;
}

/**
 * Build the COMPRESSION prompt (CP504 §4.5.0). Atoms are indexed so the model
 * references them by number. Unlike the old clustering prompt, this one is told
 * to COMPRESS — keep high-value atoms, abstract enumeration-clusters into
 * pattern+example, and intentionally DROP low-value atoms (importance judged
 * against the mandala's center goal). No drop-0 fallback downstream.
 */
export function buildTopicSynthesisPrompt(
  cellTitle: string,
  atoms: TopicAtom[],
  maxTopics: number,
  centerGoal: string
): string {
  const indexed = atoms.map((a, i) => `[${i}] ${a.text}`).join('\n');
  return [
    `당신은 학습 노트를 "나열"에서 "압축"으로 바꾸는 편집자다. 목표는 독자가 5분 안에 핵심을 파악하는 책의 한 챕터다.`,
    `이 책 전체의 목표(센터골): "${centerGoal}"`,
    `이 챕터(주제군): "${cellTitle}"`,
    ``,
    `아래는 여러 영상에서 추출한 학습 조각(atom)들이다. 각 줄 앞 [n]은 조각 번호다. 총 ${atoms.length}개 — 통째로 나열하면 독자가 안 본다.`,
    indexed,
    ``,
    `압축 작업 (나열 금지):`,
    `1. 중요도 선별: 센터골에 핵심인 조각만 남긴다. 덜 중요하거나 곁가지인 조각은 의도적으로 버린다(drop). 모든 조각을 담으려 하지 마라 — 그게 나열이다.`,
    `2. 나열형 군집 추상화: 같은 패턴이 여러 번 반복되면(예: 회화 표현 100개) 통째 나열하지 말고 "패턴 + 대표 예시 몇 개"로 묶는다. content에 패턴을 쓰고 atom_idx로 근거 조각을 가리킨다.`,
    `3. 고가치 개별 조각은 추상화하지 말고 그대로 살린다(디테일이 가치인 경우). top 중요도 순.`,
    `4. 섹션 제목(title)은 내용을 설명하는 이름. 영상제목·채널명·클릭베이트 금지.`,
    `5. content는 그 섹션의 핵심을 담은 압축 서술. 조각에 없는 사실을 지어내지 마라(창작 금지 — content의 모든 주장은 atom_idx가 가리키는 조각에 근거해야 한다).`,
    `6. atom_idx = 그 섹션이 근거로 삼은 조각 번호들(출처 보존). 버린 조각은 어느 섹션에도 넣지 않는다(그게 압축이다).`,
    `7. 섹션 수는 내용에 맞게, 최대 ${maxTopics}개. 압축이므로 입력 조각 수보다 훨씬 적어야 정상이다.`,
    ``,
    `★ content는 반드시 한 줄(개행·줄바꿈 문자 절대 금지 — JSON 파싱 보호).`,
    `JSON만 출력(코드펜스 금지):`,
    `{"sections":[{"title":"...","content":"...","atom_idx":[0,3,5]}]}`,
  ].join('\n');
}

/**
 * Synthesize a cell's atom pool into content topics. Returns topics with
 * provenance (atom_refs resolved from LLM indices); never fabricates a vid/ts.
 * Honest fail → ok:false (caller keeps the prior per-video sections).
 */
export async function synthesizeCellTopics(
  cellTitle: string,
  atoms: TopicAtom[],
  centerGoal: string,
  cellCap?: number
): Promise<TopicSynthesisResult> {
  if (atoms.length === 0) return { ok: false, reason: 'no_atoms' };

  // Truncation guard: retry on a parse/provider failure (truncated JSON, transient
  // error) before reporting a HARD failure. A hard failure is surfaced LOUDLY —
  // the caller must NOT silently revert the cell to legacy per-video (which would
  // resurrect defect-1 clickbait titles). The retry is the primary guard; 8000
  // tokens makes 942's largest cell fit so it should not be reached for 942.
  let lastReason = 'unknown';
  for (let attempt = 1; attempt <= SYNTHESIS_ATTEMPTS; attempt++) {
    const r = await attemptSynthesis(cellTitle, atoms, centerGoal, cellCap);
    if (r.ok) {
      if (attempt > 1) log.info('topic-synthesis recovered on retry', { cellTitle, attempt });
      return r;
    }
    lastReason = r.reason;
    // CP504 §11 — SYNTHESIS_ATTEMPTS is now for PROVIDER faults only. Parse
    // failures are salvaged in-attempt (parseJsonLenient: unescaped-newline +
    // truncation), so a re-call to Sonnet no longer buys anything and just burns
    // cost — measured 4 of 13 calls per book were these parse retries.
    const retryable = r.reason.startsWith('provider_error');
    if (retryable && attempt < SYNTHESIS_ATTEMPTS) {
      log.warn('topic-synthesis provider error — retrying', {
        cellTitle,
        attempt,
        reason: r.reason,
      });
      continue;
    }
    break; // non-retryable (parse/structural) → stop; do not waste an LLM call
  }
  log.error('topic-synthesis HARD FAIL after retries (NOT a silent legacy revert)', {
    cellTitle,
    atoms: atoms.length,
    reason: lastReason,
  });
  return { ok: false, reason: `hard_fail: ${lastReason}` };
}

/** One COMPRESSION attempt: generate → parse → resolve. NO drop-0 fallback —
 *  atoms the model omits are the intentional compression drop (removed.compressed). */
async function attemptSynthesis(
  cellTitle: string,
  atoms: TopicAtom[],
  centerGoal: string,
  cellCap?: number
): Promise<TopicSynthesisResult> {
  // CP504 §1⑤ surface-fix #3 — note-level cap. cellCap = this cell's share of
  // NOTE_MAX_SECTIONS (distributed by atom count in fill-book), tightening the
  // per-cell topicCapFor so the WHOLE note's section count — not just each cell —
  // stays "5-min scannable". Unset ⇒ legacy per-cell cap only.
  const maxTopics =
    cellCap != null
      ? Math.max(MIN_TOPICS_PER_CELL, Math.min(cellCap, topicCapFor(atoms.length)))
      : topicCapFor(atoms.length);
  const prompt = buildTopicSynthesisPrompt(cellTitle, atoms, maxTopics, centerGoal);

  let raw: string;
  try {
    raw = await new OpenRouterGenerationProvider(SONNET_MODEL).generate(prompt, {
      format: 'json',
      temperature: TEMPERATURE,
      maxTokens: MAX_TOKENS,
      purpose: 'cell_synthesis', // CP504 §3 per-stage cost attribution
    });
  } catch (err) {
    return {
      ok: false,
      reason: `provider_error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const stripped = raw
    .trim()
    .replace(/^\s*```(?:json)?\s*\n?/i, '')
    .replace(/\n?\s*```\s*$/i, '')
    .trim();

  // CP504 §11 — lenient parse: salvage the unescaped-newline / truncation cases
  // in-attempt (no LLM retry). `via` is the parse-recovery counter — logged so we
  // can confirm retries dropped to 0 while salvages absorb the model's stray
  // newlines (the prompt-side "개행 금지" defense is not reliably obeyed).
  const json = parseJsonLenient<{ sections?: unknown }>(stripped, (via) => {
    log.info('topic-synthesis json salvaged in-attempt (no LLM retry)', { cellTitle, via });
  });
  if (json === null) {
    return { ok: false, reason: 'json_parse: unparseable after lenient salvage' };
  }
  if (!Array.isArray(json.sections)) return { ok: false, reason: 'no_sections_array' };

  // Resolve LLM atom indices → real {vid, ts}. Drop out-of-range / duplicate
  // indices (no fabrication). Atoms NOT referenced by any section are the
  // COMPRESSION drop (intentional) — recorded in removed.compressed, never reassigned.
  const used = new Set<number>();
  const topics: TopicSection[] = [];
  for (const s of (json.sections as LlmSection[]).slice(0, maxTopics)) {
    const title = typeof s.title === 'string' ? s.title.trim() : '';
    if (!title) continue;
    const idxs = Array.isArray(s.atom_idx) ? s.atom_idx : [];
    const refs: Array<{ vid: string; ts: number }> = [];
    for (const rawIdx of idxs) {
      const i = typeof rawIdx === 'number' ? rawIdx : Number(rawIdx);
      if (!Number.isInteger(i) || i < 0 || i >= atoms.length || used.has(i)) continue;
      used.add(i);
      refs.push({ vid: atoms[i]!.vid, ts: atoms[i]!.ts });
    }
    if (refs.length === 0) continue; // a section citing no real atoms is dropped
    // content is single-line per prompt; defensively collapse any stray newline
    // (the known Sonnet/Haiku unescaped-newline → JSON.parse trip; CP504 §11).
    const content =
      typeof s.content === 'string' ? s.content.replace(/\s*\n+\s*/g, ' ').trim() : '';
    topics.push({ topic_title: title, summary: content, atom_refs: refs });
  }

  if (topics.length === 0) return { ok: false, reason: 'no_valid_sections' };

  // COMPRESSION drop: atoms no section referenced are dropped ON PURPOSE
  // (the point of §1⑤). Logged transparently; NOT reassigned to a nearest topic.
  const compressed = atoms.map((_, i) => i).filter((i) => !used.has(i));
  const removed: RemovedAtoms = { compressed, dedup: [], safety: [] };

  log.info('topic-synthesis (compression) done', {
    cellTitle,
    atomsIn: atoms.length,
    sections: topics.length,
    atomsKept: used.size,
    atomsCompressed: compressed.length, // intentional drop
    compressionPct: atoms.length ? Math.round((compressed.length / atoms.length) * 100) : 0,
  });
  return { ok: true, topics, removed };
}
