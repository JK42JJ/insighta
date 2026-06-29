// §4.5.1 [3] Chapter body weave (CP504 note-form-redesign).
//
// STEP 2 of the narrative pipeline. STEP 1 (book-skeleton) decided WHICH topics
// go in WHICH chapter, in what order, with a chapter intro. This step turns each
// chapter's topics — currently isolated §1⑤ topic summaries — into flowing,
// chapter-aware narrative prose.
//
// Creation boundary ([INV-NOTE-CREATION], the whole point):
//   - connective / transition phrasing = CREATION (서사)
//   - facts                            = SOURCED — the model may only use facts
//     already present in the given topic summaries (which are themselves
//     atom-grounded from §1⑤). It must NOT introduce a fact not in the summaries.
// The atom provenance (atom_refs) is NOT touched here — only `narrative` text is
// rewritten — so {vid,ts} back-links (figure / relevance / seek) still travel.
//
// One Sonnet call per chapter. Honest fail → caller keeps the original topic
// summaries (no silent fabrication, no broken chapter).
//
// Service module — OpenRouter Sonnet is a PRODUCTION LLM call; CC MUST NOT call
// it for tests (unit tests cover the pure parse/map path with fixtures).

import { OpenRouterGenerationProvider } from '@/modules/llm/openrouter';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'mandala-book/book-body' });

const SONNET_MODEL = 'anthropic/claude-sonnet-4-6';
const MAX_TOKENS = 8000;
const BODY_ATTEMPTS = 2;
const TEMPERATURE = 0.3;

/** One topic to weave (the §1⑤ title + atom-grounded summary). */
export interface BodyTopicInput {
  topicTitle: string;
  summary: string;
}

export type ChapterBodyResult =
  | { ok: true; narratives: string[] } // index-aligned with the input topics
  | { ok: false; reason: string };

interface LlmBodySection {
  idx?: unknown;
  narrative?: unknown;
}

/**
 * Build the body-weave prompt. Topics are locally indexed; the model rewrites
 * each into chapter-aware prose, told explicitly that it may create connective
 * narrative but NOT facts beyond the given summaries.
 */
export function buildChapterBodyPrompt(
  chapterTitle: string,
  intro: string,
  topics: BodyTopicInput[],
  centerGoal: string
): string {
  const indexed = topics.map((t, i) => `[${i}] ${t.topicTitle}: ${t.summary}`).join('\n');
  return [
    `당신은 "한 권의 책"의 한 챕터를 쓰는 저자다. 아래 토픽들을 흐름 있는 본문으로 엮어라.`,
    `이 책의 주제(센터골): "${centerGoal}"`,
    `이 챕터: "${chapterTitle}"`,
    intro ? `이 챕터의 도입(맥락): ${intro}` : ``,
    ``,
    `챕터의 토픽들 (각 줄 [n]은 토픽 번호, 콜론 뒤는 그 토픽의 사실 요약):`,
    indexed,
    ``,
    `본문 작성 규칙:`,
    `1. 각 토픽 [n]에 대해, 그 토픽을 챕터 흐름 안에서 자연스럽게 읽히도록 다시 쓴다(서술 narrative).`,
    `2. 연결·전환·맥락 문장은 창작해도 된다(예: "앞에서 다진 기초를 바탕으로"). 그러나 ★사실은 주어진 요약에 있는 것만 써라 — 요약에 없는 새 사실(표현·수치·이름·개념)을 절대 지어내지 마라.`,
    `3. 토픽 순서와 개수를 유지한다(입력 ${topics.length}개 → 출력 ${topics.length}개, idx 일치).`,
    `4. 각 narrative는 토픽 요약보다 풍부하되 간결하게(2-4문장). 영상제목·채널명 금지.`,
    ``,
    `★ 각 narrative는 한 줄(개행·줄바꿈 문자 절대 금지 — JSON 파싱 보호).`,
    `JSON만 출력(코드펜스 금지):`,
    `{"sections":[{"idx":0,"narrative":"..."}]}`,
  ]
    .filter((l) => l !== ``)
    .join('\n');
}

/**
 * Weave one chapter's topics into chapter-aware narrative prose. Returns an
 * index-aligned array of rewritten narratives (narratives[i] ↔ topics[i]).
 * Honest fail → ok:false (caller keeps the original topic summaries).
 */
export async function weaveChapterBody(
  chapterTitle: string,
  intro: string,
  topics: BodyTopicInput[],
  centerGoal: string
): Promise<ChapterBodyResult> {
  if (topics.length === 0) return { ok: false, reason: 'no_topics' };

  let lastReason = 'unknown';
  for (let attempt = 1; attempt <= BODY_ATTEMPTS; attempt++) {
    const r = await attemptBody(chapterTitle, intro, topics, centerGoal);
    if (r.ok) {
      if (attempt > 1) log.info('chapter-body recovered on retry', { chapterTitle, attempt });
      return r;
    }
    lastReason = r.reason;
    if (attempt < BODY_ATTEMPTS) {
      log.warn('chapter-body attempt failed — retrying', {
        chapterTitle,
        attempt,
        reason: r.reason,
      });
    }
  }
  log.warn('chapter-body fail after retries → keep original summaries (no fabrication)', {
    chapterTitle,
    reason: lastReason,
  });
  return { ok: false, reason: `fail: ${lastReason}` };
}

async function attemptBody(
  chapterTitle: string,
  intro: string,
  topics: BodyTopicInput[],
  centerGoal: string
): Promise<ChapterBodyResult> {
  const prompt = buildChapterBodyPrompt(chapterTitle, intro, topics, centerGoal);
  let raw: string;
  try {
    raw = await new OpenRouterGenerationProvider(SONNET_MODEL).generate(prompt, {
      format: 'json',
      temperature: TEMPERATURE,
      maxTokens: MAX_TOKENS,
    });
  } catch (err) {
    return {
      ok: false,
      reason: `provider_error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  return parseChapterBodyResponse(raw, topics.length);
}

/**
 * Pure parse + index-map of the body response. Exported for fixture unit tests
 * (no live LLM). Returns narratives index-aligned with the input topics; any
 * topic the model omits keeps an empty slot (caller falls back to its summary).
 * Fails only if the response is unusable (not JSON / no sections / none mapped).
 */
export function parseChapterBodyResponse(raw: string, topicCount: number): ChapterBodyResult {
  const stripped = raw
    .trim()
    .replace(/^\s*```(?:json)?\s*\n?/i, '')
    .replace(/\n?\s*```\s*$/i, '')
    .trim();

  let json: { sections?: unknown };
  try {
    json = JSON.parse(stripped) as { sections?: unknown };
  } catch (err) {
    return { ok: false, reason: `json_parse: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!Array.isArray(json.sections)) return { ok: false, reason: 'no_sections_array' };

  const narratives: string[] = new Array(topicCount).fill('');
  let mapped = 0;
  for (const s of json.sections as LlmBodySection[]) {
    const i = typeof s.idx === 'number' ? s.idx : Number(s.idx);
    if (!Number.isInteger(i) || i < 0 || i >= topicCount) continue;
    const narrative =
      typeof s.narrative === 'string' ? s.narrative.replace(/\s*\n+\s*/g, ' ').trim() : '';
    if (!narrative) continue;
    if (narratives[i] === '') mapped += 1; // first write for this idx
    narratives[i] = narrative;
  }
  if (mapped === 0) return { ok: false, reason: 'no_mapped_sections' };
  return { ok: true, narratives };
}
