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
// Service module — OpenRouter Haiku is a production LLM call (the deployed
// pipeline / a James-run prototype invokes it; CC must not call it for tests).

import { OpenRouterGenerationProvider } from '@/modules/llm/openrouter';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'mandala-book/topic-synthesis' });

const HAIKU_MODEL = 'anthropic/claude-haiku-4.5';
const MAX_TOKENS = 2000;
const TEMPERATURE = 0.2;
// Cap topics per cell so the LLM can't explode a cell into dozens of fragments.
const MAX_TOPICS_PER_CELL = 6;

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
}

export type TopicSynthesisResult =
  | { ok: true; topics: TopicSection[]; droppedAtomIdx: number[] }
  | { ok: false; reason: string };

interface LlmTopic {
  topic_title?: unknown;
  summary?: unknown;
  atom_idx?: unknown;
}

/** Build the clustering prompt. Atoms are indexed so the model references them. */
export function buildTopicSynthesisPrompt(cellTitle: string, atoms: TopicAtom[]): string {
  const indexed = atoms.map((a, i) => `[${i}] ${a.text}`).join('\n');
  return [
    `당신은 한 주제군의 학습 조각(atom)들을 "내용 토픽"으로 재구성하는 편집자다.`,
    `주제군(셀): "${cellTitle}"`,
    ``,
    `아래는 이 주제군에 속한 여러 영상에서 추출한 핵심 조각들이다. 각 줄 앞 [n]은 조각 번호다.`,
    indexed,
    ``,
    `작업:`,
    `1. 조각들을 "내용 흐름"으로 묶어 자연스러운 토픽으로 재구성하라. 영상 경계는 무시한다 — 같은 내용이면 다른 영상의 조각이라도 한 토픽으로 묶는다.`,
    `2. 토픽 제목(topic_title)은 반드시 "내용을 설명하는 이름"이어야 한다. 영상 제목·채널명·클릭베이트 금지. (예: O "REST API 라우터 구조", X "이 영상 하나면 끝!")`,
    `3. 토픽 수는 내용에 맞게 자연스럽게 정하되 최대 ${MAX_TOPICS_PER_CELL}개를 넘지 않는다.`,
    `4. summary는 토픽의 1-2문장 요약. 조각에 없는 사실을 지어내지 마라(라벨링·요약만, 창작 금지).`,
    `5. 각 토픽은 atom_idx 배열로 자신이 묶은 조각 번호들을 가리킨다(출처 보존). 한 조각은 한 토픽에만.`,
    ``,
    `JSON만 출력(코드펜스 금지):`,
    `{"topics":[{"topic_title":"...","summary":"...","atom_idx":[0,3,5]}]}`,
  ].join('\n');
}

/**
 * Synthesize a cell's atom pool into content topics. Returns topics with
 * provenance (atom_refs resolved from LLM indices); never fabricates a vid/ts.
 * Honest fail → ok:false (caller keeps the prior per-video sections).
 */
export async function synthesizeCellTopics(
  cellTitle: string,
  atoms: TopicAtom[]
): Promise<TopicSynthesisResult> {
  if (atoms.length === 0) return { ok: false, reason: 'no_atoms' };

  const prompt = buildTopicSynthesisPrompt(cellTitle, atoms);

  let raw: string;
  try {
    raw = await new OpenRouterGenerationProvider(HAIKU_MODEL).generate(prompt, {
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

  const stripped = raw
    .trim()
    .replace(/^\s*```(?:json)?\s*\n?/i, '')
    .replace(/\n?\s*```\s*$/i, '')
    .trim();

  let json: { topics?: unknown };
  try {
    json = JSON.parse(stripped) as { topics?: unknown };
  } catch (err) {
    return { ok: false, reason: `json_parse: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!Array.isArray(json.topics)) return { ok: false, reason: 'no_topics_array' };

  // Resolve LLM atom indices → real {vid, ts}. Drop out-of-range / duplicate
  // indices (no fabrication). Track which atoms the model placed somewhere.
  const used = new Set<number>();
  const topics: TopicSection[] = [];
  for (const t of (json.topics as LlmTopic[]).slice(0, MAX_TOPICS_PER_CELL)) {
    const title = typeof t.topic_title === 'string' ? t.topic_title.trim() : '';
    if (!title) continue;
    const idxs = Array.isArray(t.atom_idx) ? t.atom_idx : [];
    const refs: Array<{ vid: string; ts: number }> = [];
    for (const raw of idxs) {
      const i = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isInteger(i) || i < 0 || i >= atoms.length || used.has(i)) continue;
      used.add(i);
      refs.push({ vid: atoms[i]!.vid, ts: atoms[i]!.ts });
    }
    if (refs.length === 0) continue; // a topic with no real atoms is dropped
    topics.push({
      topic_title: title,
      summary: typeof t.summary === 'string' ? t.summary.trim() : '',
      atom_refs: refs,
    });
  }

  if (topics.length === 0) return { ok: false, reason: 'no_valid_topics' };

  const droppedAtomIdx = atoms.map((_, i) => i).filter((i) => !used.has(i));
  log.info('topic-synthesis done', {
    cellTitle,
    atomsIn: atoms.length,
    topics: topics.length,
    atomsPlaced: used.size,
    atomsDropped: droppedAtomIdx.length,
  });
  return { ok: true, topics, droppedAtomIdx };
}
