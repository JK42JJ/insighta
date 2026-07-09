// §4.5.1 [2] Book narrative skeleton (CP504 note-form-redesign).
//
// Takes ALL cells' §1⑤-compressed topics (the "재료"), the mandala center goal
// (주제), and per-cell weight (sector 무게), and asks Sonnet to RECONSTRUCT them
// into a narrative book outline — NOT a cell→chapter 1:1 copy:
//   - cross-cell merge   (the same theme scattered across cells → one chapter)
//   - narrative order     (기→승→전→결, NOT mandala cell index order)
//   - chapter intro       (연결 서사 — the only NEW prose this stage creates)
//
// Creation boundary ([INV-NOTE-CREATION]): the model creates STRUCTURE + intro
// narrative ONLY. It does NOT invent facts — it references the existing topics by
// GLOBAL INDEX (same provenance-by-index trick as topic-synthesis), and code
// resolves those indices back to real TopicSections. A chapter citing no real
// topic is dropped. Facts stay sourced; only the skeleton+intro are synthesized.
//
// Deliberately ISOLATED from build-book (which stays PURE): this is the
// non-deterministic step; build-book consumes the resolved skeleton.
//
// Service module — OpenRouter Sonnet is a PRODUCTION LLM call (the deployed
// pipeline / a James-run prototype invokes it). CC MUST NOT call it for tests;
// unit tests cover the pure parse/resolve path with fixtures.

import { OpenRouterGenerationProvider } from '@/modules/llm/openrouter';
import { logger } from '@/utils/logger';
import { parseJsonLenient } from '@/utils/lenient-json';

const log = logger.child({ module: 'mandala-book/book-skeleton' });

// Same model family as §1⑤ compression — Sonnet preserves provenance + writes
// coherent Korean narrative (CP504 §7.5 6-model + dual-blind-judge verdict).
const SONNET_MODEL = 'anthropic/claude-sonnet-4-6';
// The skeleton lists topic indices + short intro prose only (not full bodies),
// so the output is compact; 8000 holds a large book outline. Retry covers a
// transient truncation.
const MAX_TOKENS = 8000;
const SKELETON_ATTEMPTS = 2;
const TEMPERATURE = 0.3; // a touch above §1⑤ (0.2) — narrative framing, still grounded
// Chapter-count target: a readable book, not a wall. ~1 chapter per ~4 topics,
// clamped so even a big mandala stays scannable.
const TOPICS_PER_CHAPTER = 4;
const MIN_CHAPTERS = 2;
const MAX_CHAPTERS_CAP = 12;
function chapterCapFor(topicCount: number): number {
  return Math.min(
    MAX_CHAPTERS_CAP,
    Math.max(MIN_CHAPTERS, Math.ceil(topicCount / TOPICS_PER_CHAPTER))
  );
}

/** One compressed topic (flattened across all cells, in cell order). */
export interface SkeletonTopicInput {
  cellIndex: number; // source mandala cell (for weight/debug; provenance travels via atom_refs downstream)
  cellTitle: string; // the cell's sub-goal label (context for the model)
  topicTitle: string; // §1⑤ topic_title
  summary: string; // §1⑤ topic summary (1-2 lines)
}

/** A narrative chapter: a grouping of topics (by GLOBAL index) with framing. */
export interface SkeletonChapter {
  title: string; // narrative chapter title (창작)
  intro: string; // connective narrative — frames how this chapter fits the flow (창작)
  topic_refs: number[]; // GLOBAL indices into the flat topic list (provenance preserved)
}

export interface BookSkeleton {
  chapters: SkeletonChapter[];
}

export type BookSkeletonResult =
  | { ok: true; skeleton: BookSkeleton; unplaced: number[] }
  | { ok: false; reason: string };

interface LlmChapter {
  title?: unknown;
  intro?: unknown;
  topic_idx?: unknown;
}

/**
 * Build the narrative-reconstruction prompt. Topics are globally indexed so the
 * model groups them by number; it is told to DISSOLVE cell boundaries and order
 * by narrative flow, and that it may only create the title/intro — never facts.
 */
export function buildBookSkeletonPrompt(
  topics: SkeletonTopicInput[],
  centerGoal: string,
  maxChapters: number
): string {
  const indexed = topics
    .map((t, i) => `[${i}] (${t.cellTitle}) ${t.topicTitle} — ${t.summary}`)
    .join('\n');
  return [
    `당신은 학습 노트를 "한 권의 책"으로 엮는 편집자다. 아래 토픽들은 만다라의 여러 셀(공간 분류)에서 압축된 재료다. 셀은 책의 목차가 아니라 재료의 출처일 뿐이다.`,
    `이 책의 주제(센터골): "${centerGoal}"`,
    ``,
    `재료 토픽 (각 줄 앞 [n]은 토픽 번호, 괄호는 출처 셀):`,
    indexed,
    ``,
    `목차 재구성 작업:`,
    `1. 셀 경계를 버려라. 여러 셀에 흩어진 같은/이어지는 주제는 한 챕터로 모은다. 한 셀이 너무 크면 여러 챕터로 쪼갠다.`,
    `2. 챕터 순서는 셀 번호 순이 아니라 "기승전결" 흐름이다: 도입(왜·무엇) → 기초(전제·뼈대) → 실전(적용·전환) → 마무리(종합·다음).`,
    `3. 각 챕터에 intro(2-3문장)를 쓴다 — 이 챕터가 앞뒤 흐름에서 어디에 있고 무엇을 다루는지 연결하는 서사. intro는 창작이되, 토픽에 없는 "사실"을 지어내지 마라(흐름·연결만 창작, 사실은 토픽이 근거).`,
    `4. title은 내용을 설명하는 챕터 제목(영상제목·셀제목 복사 금지).`,
    `5. topic_idx = 그 챕터에 속한 토픽 번호들. 모든 토픽을 어느 챕터엔가 배치하려 노력하되, 한 토픽을 두 챕터에 넣지 마라(중복 금지).`,
    `6. 챕터 수는 흐름에 맞게, 최대 ${maxChapters}개.`,
    ``,
    `★ title·intro는 각각 한 줄(개행·줄바꿈 문자 절대 금지 — JSON 파싱 보호).`,
    `JSON만 출력(코드펜스 금지):`,
    `{"chapters":[{"title":"...","intro":"...","topic_idx":[0,3,5]}]}`,
  ].join('\n');
}

/**
 * Reconstruct a narrative book skeleton from all cells' compressed topics.
 * Returns chapters referencing topics by global index (resolved/validated), plus
 * the list of topics no chapter placed (transparency — logged, not auto-appended).
 * Honest fail → ok:false (caller keeps the prior cell=chapter assembly).
 */
export async function synthesizeBookSkeleton(
  topics: SkeletonTopicInput[],
  centerGoal: string
): Promise<BookSkeletonResult> {
  if (topics.length === 0) return { ok: false, reason: 'no_topics' };

  let lastReason = 'unknown';
  for (let attempt = 1; attempt <= SKELETON_ATTEMPTS; attempt++) {
    const r = await attemptSkeleton(topics, centerGoal);
    if (r.ok) {
      if (attempt > 1) log.info('book-skeleton recovered on retry', { attempt });
      return r;
    }
    lastReason = r.reason;
    // CP504 §11 — retry PROVIDER faults only. Parse failures are salvaged
    // in-attempt (parseSkeletonResponse → parseJsonLenient), so re-calling Sonnet
    // for a parse error just burns cost.
    const retryable = r.reason.startsWith('provider_error');
    if (retryable && attempt < SKELETON_ATTEMPTS) {
      log.warn('book-skeleton provider error — retrying', { attempt, reason: r.reason });
      continue;
    }
    break; // non-retryable (parse/structural) → stop; do not waste an LLM call
  }
  log.error('book-skeleton HARD FAIL after retries (NOT a silent legacy revert)', {
    topics: topics.length,
    reason: lastReason,
  });
  return { ok: false, reason: `hard_fail: ${lastReason}` };
}

async function attemptSkeleton(
  topics: SkeletonTopicInput[],
  centerGoal: string
): Promise<BookSkeletonResult> {
  const maxChapters = chapterCapFor(topics.length);
  const prompt = buildBookSkeletonPrompt(topics, centerGoal, maxChapters);

  let raw: string;
  try {
    raw = await new OpenRouterGenerationProvider(SONNET_MODEL).generate(prompt, {
      format: 'json',
      temperature: TEMPERATURE,
      maxTokens: MAX_TOKENS,
      purpose: 'book_skeleton', // CP504 §3 per-stage cost attribution
    });
  } catch (err) {
    return {
      ok: false,
      reason: `provider_error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const parsed = parseSkeletonResponse(raw, topics.length, maxChapters);
  if (!parsed.ok) return parsed;

  const placed = new Set<number>();
  for (const ch of parsed.skeleton.chapters) for (const i of ch.topic_refs) placed.add(i);
  const unplaced = topics.map((_, i) => i).filter((i) => !placed.has(i));

  log.info('book-skeleton done', {
    topicsIn: topics.length,
    chapters: parsed.skeleton.chapters.length,
    topicsPlaced: placed.size,
    topicsUnplaced: unplaced.length, // transparency — NOT auto-appended (would fight the narrative)
  });
  return { ok: true, skeleton: parsed.skeleton, unplaced };
}

/**
 * Pure parse + index-resolve of the LLM response. Exported so unit tests can
 * cover the resolution/validation path WITHOUT a live LLM call (LLM-API ban).
 * Drops out-of-range / duplicate topic indices (no fabrication) and chapters
 * that end up citing no real topic.
 */
export function parseSkeletonResponse(
  raw: string,
  topicCount: number,
  maxChapters: number
): { ok: true; skeleton: BookSkeleton } | { ok: false; reason: string } {
  const stripped = raw
    .trim()
    .replace(/^\s*```(?:json)?\s*\n?/i, '')
    .replace(/\n?\s*```\s*$/i, '')
    .trim();

  // CP504 §11 — lenient parse: salvage unescaped-newline / truncation in-place
  // (no LLM retry). `via` is the parse-recovery counter (logged for verification).
  const json = parseJsonLenient<{ chapters?: unknown }>(stripped, (via) => {
    log.info('book-skeleton json salvaged in-attempt (no LLM retry)', { via });
  });
  if (json === null) {
    return { ok: false, reason: 'json_parse: unparseable after lenient salvage' };
  }
  if (!Array.isArray(json.chapters)) return { ok: false, reason: 'no_chapters_array' };

  const usedTopic = new Set<number>(); // a topic belongs to at most one chapter
  const chapters: SkeletonChapter[] = [];
  for (const c of (json.chapters as LlmChapter[]).slice(0, maxChapters)) {
    const title = typeof c.title === 'string' ? c.title.replace(/\s*\n+\s*/g, ' ').trim() : '';
    if (!title) continue;
    const intro = typeof c.intro === 'string' ? c.intro.replace(/\s*\n+\s*/g, ' ').trim() : '';
    const idxs = Array.isArray(c.topic_idx) ? c.topic_idx : [];
    const refs: number[] = [];
    for (const rawIdx of idxs) {
      const i = typeof rawIdx === 'number' ? rawIdx : Number(rawIdx);
      if (!Number.isInteger(i) || i < 0 || i >= topicCount || usedTopic.has(i)) continue;
      usedTopic.add(i);
      refs.push(i);
    }
    if (refs.length === 0) continue; // a chapter citing no real topic is dropped (no fabrication)
    chapters.push({ title, intro, topic_refs: refs });
  }

  if (chapters.length === 0) return { ok: false, reason: 'no_valid_chapters' };
  return { ok: true, skeleton: { chapters } };
}
