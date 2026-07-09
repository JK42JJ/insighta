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

/** Per-section output: rich-markdown narrative + key-point prose synthesis. */
export interface BodySectionResult {
  narrative: string; // Rich markdown (newlines preserved); do NOT strip.
  keyPoints: string[]; // Back-compat (old array contract). Empty by default; generation fills keyPoint.
  keyPoint?: string; // 2-3 sentence prose synthesis; absent when model omits.
}

export type ChapterBodyResult =
  | { ok: true; sections: BodySectionResult[] } // index-aligned with the input topics
  | { ok: false; reason: string };

interface LlmBodySection {
  idx?: unknown;
  narrative?: unknown;
  keyPoints?: unknown; // Back-compat: old array contract (ignored by parser, kept for back-compat).
  keyPoint?: unknown; // New: prose synthesis string.
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
    `1. 각 토픽 [n]에 대해, 챕터 흐름 안에서 자연스럽게 읽히도록 다시 쓴다(narrative).`,
    `2. 연결·전환·맥락 문장은 창작해도 된다(예: "앞에서 다진 기초를 바탕으로"). ★사실은 주어진 요약에 있는 것만 써라 — 요약에 없는 사실·수치·이름·개념을 절대 지어내지 마라.`,
    `3. 토픽 순서·개수를 유지한다(입력 ${topics.length}개 → 출력 ${topics.length}개, idx 일치).`,
    `4. 영상 제목·채널명 금지.`,
    ``,
    `★ narrative는 RICH MARKDOWN — 내용에 적합한 도구를 선택(모든 섹션에 억지로 모든 도구 쓰지 말 것):`,
    `• **굵게**: 정의되는 핵심 용어 + 결정적 수치("75%", "4비트") 전용. 장식·일반명사에 쓰지 말 것.`,
    `• \`- \` 불릿 목록: 순서 없는 열거.`,
    `• \`1. \` 번호 목록: 단계별 절차·순서.`,
    `• \`> [!note]\` / \`> [!tip]\` / \`> [!warning]\`: 보충 callout (Obsidian admonition 형식).`,
    `• \`\`\`mermaid\\n...\`\`\`: 흐름·관계·아키텍처(예: flowchart LR; A-->B). 실제 구조가 있을 때만.`,
    `• \`| 열 | 열 |\` GFM 테이블: A vs B 비교가 있으면 반드시 테이블.`,
    `• 그 외: 빈 줄로 구분된 산문 단락.`,
    `도구 강제 원칙: 비교→테이블, 다단계 절차→번호 목록, 흐름·관계→mermaid. 밀도·학술적 명확성 우선.`,
    ``,
    `5. 각 토픽에 keyPoint를 작성한다: 이 섹션의 본질을 새 문장으로 압축한 2-3문장 산문 종합.`,
    `   ★ 불릿 금지. narrative 문장 그대로 반복 금지. 독자가 기억해야 할 핵심 통찰만.`,
    ``,
    `JSON만 출력(코드펜스 없이). narrative 안의 개행은 \\n으로 이스케이프(JSON 문자열 규칙):`,
    `{"sections":[{"idx":0,"narrative":"<마크다운>","keyPoint":"<2-3문장 산문>"}]}`,
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
      purpose: 'chapter_weave', // CP504 §3 per-stage cost attribution
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
 * (no live LLM). Returns sections index-aligned with the input topics; any
 * topic the model omits keeps an empty-narrative slot (caller falls back to its
 * summary). narrative is kept raw (markdown; newlines preserved — NOT collapsed).
 * keyPoint: 2-3 sentence prose synthesis (optional; undefined when model omits).
 * keyPoints: back-compat array (empty when omitted; generation now fills keyPoint).
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

  const sections: BodySectionResult[] = Array.from({ length: topicCount }, () => ({
    narrative: '',
    keyPoints: [],
  }));
  let mapped = 0;
  for (const s of json.sections as LlmBodySection[]) {
    const i = typeof s.idx === 'number' ? s.idx : Number(s.idx);
    if (!Number.isInteger(i) || i < 0 || i >= topicCount) continue;
    // Preserve raw markdown — do NOT strip newlines (markdown structure depends on them).
    const narrative = typeof s.narrative === 'string' ? s.narrative.trim() : '';
    if (!narrative) continue;
    if (sections[i]!.narrative === '') mapped += 1; // first write for this idx
    // keyPoint: 2-3 sentence prose synthesis (new contract). Optional string.
    const keyPoint = typeof s.keyPoint === 'string' ? s.keyPoint.trim() || undefined : undefined;
    // keyPoints: back-compat (old array contract). Trimmed, non-empty, capped at 3.
    const rawKp = Array.isArray(s.keyPoints) ? (s.keyPoints as unknown[]) : [];
    const keyPoints = rawKp
      .filter((k): k is string => typeof k === 'string')
      .map((k) => k.replace(/\s*\n+\s*/g, ' ').trim())
      .filter((k) => k.length > 0)
      .slice(0, 3);
    sections[i] = { narrative, keyPoints, keyPoint };
  }
  if (mapped === 0) return { ok: false, reason: 'no_mapped_sections' };
  return { ok: true, sections };
}
