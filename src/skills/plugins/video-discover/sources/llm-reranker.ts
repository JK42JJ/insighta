/**
 * llm-reranker — CP360 experiment #3 Phase 1-F
 *
 * After the quality gate, language filter, blocklist, and Shorts filter have
 * all run, the remaining candidate pool is reranked by a single OpenRouter
 * call that answers one question per video: "does this video actually help
 * the user learn {centerGoal} / {subGoal}?". Verdicts are batched into a
 * single prompt for token efficiency (20 videos ~= 40 output tokens vs 20
 * round-trips).
 *
 * Design notes (see user discussion in CP360 /work planning):
 *
 *   1. BATCHED 1 call, not 20 — token efficiency matters at ~$0.02/mandala.
 *   2. PARTIAL parse allowed — strict JSON parser first, regex fallback
 *      second, and whatever we got is applied. Missing verdicts default
 *      to KEEP (false-negative on a good video hurts more than letting a
 *      borderline ad slip through — the earlier blocklist already catches
 *      the obvious ones).
 *   3. PASS-THROUGH on total failure — if the HTTP call 500s or the parser
 *      returns an empty map, the skill never drops candidates. Blocking
 *      the entire pipeline on a soft-quality signal is not acceptable.
 *   4. KILL SWITCH — `VIDEO_DISCOVER_DISABLE_RERANK=1` short-circuits the
 *      whole module for incident response.
 *
 * The returned structure carries both the verdict map AND diagnostic fields
 * (`parsedCount`, `parseMode`, `durationMs`, etc.) so the executor can emit
 * a structured log row. Autoresearch Phase 3 will consume these metrics.
 */

import { logger } from '@/utils/logger';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const REQUEST_TIMEOUT_MS = 30_000;
/**
 * Max tokens the reranker can emit. Each verdict is ~5 tokens
 * (`{"i":12,"v":"N"},`). A 20-video batch needs ~120 tokens with some
 * slack. Bumped to 400 so Qwen3 builds that still leak a bit of prose
 * before the JSON array (see `llm-query-generator.ts` header comment
 * about Qwen3 thinking-mode) can still complete the array.
 */
const OPENROUTER_MAX_TOKENS = 400;
/**
 * Max candidates per batched call. 20 keeps the prompt under the
 * model's effective context for fast completion; larger batches trade
 * latency for fewer round-trips but raise the parse-failure blast radius.
 */
const DEFAULT_BATCH_SIZE = 20;

const log = logger.child({ module: 'llm-reranker' });

export type Verdict = 'Y' | 'N';

export interface RerankCandidate {
  /** Zero-based index into the input array. Used to match verdicts back. */
  index: number;
  title: string;
  channel: string;
}

export interface RerankBatchOpts {
  candidates: RerankCandidate[];
  centerGoal: string;
  /** Primary sub_goal context for the batch (used in prompt). */
  subGoal?: string;
  language: string;
  apiKey: string;
  model: string;
  batchSize?: number;
  fetchImpl?: typeof fetch;
}

export interface RerankResult {
  /** Map from candidate index → verdict. Missing entries default to KEEP. */
  verdicts: Map<number, Verdict>;
  /** How many candidates the parser actually identified. */
  parsedCount: number;
  /** Which parse path succeeded: 'json' | 'regex' | 'failed'. */
  parseMode: 'json' | 'regex' | 'failed';
  /** Wall-clock duration of the HTTP call + parse. */
  durationMs: number;
  /** Total input batch size (for telemetry divisor). */
  batchSize: number;
  /** How many verdicts were 'N' (would-be drops). */
  rejectedCount: number;
  /** Populated when the call failed end-to-end. Null on success. */
  error: string | null;
}

export class LlmRerankerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmRerankerError';
  }
}

/**
 * Rerank a batch of candidates via OpenRouter. Returns a fully populated
 * {@link RerankResult} even on failure (verdicts empty → caller keeps all).
 * Never throws — the executor's guarantee is that rerank is a soft signal.
 */
export async function rerankBatch(opts: RerankBatchOpts): Promise<RerankResult> {
  const t0 = Date.now();
  const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;
  const fetchFn = opts.fetchImpl ?? fetch;

  const empty = (error: string | null, parseMode: RerankResult['parseMode']): RerankResult => ({
    verdicts: new Map(),
    parsedCount: 0,
    parseMode,
    durationMs: Date.now() - t0,
    batchSize: opts.candidates.length,
    rejectedCount: 0,
    error,
  });

  if (opts.candidates.length === 0) {
    return empty(null, 'failed');
  }
  if (!opts.apiKey || !opts.model) {
    return empty('OpenRouter api key or model missing — skipping rerank', 'failed');
  }

  // Slice to batchSize to cap prompt size; callers needing more should
  // loop and merge.
  const batch = opts.candidates.slice(0, batchSize);

  const prompt = buildRerankPrompt({
    candidates: batch,
    centerGoal: opts.centerGoal,
    subGoal: opts.subGoal,
    language: opts.language,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let raw: string;
  try {
    const res = await fetchFn(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opts.apiKey}`,
        'HTTP-Referer': 'https://insighta.one',
        'X-Title': 'Insighta',
      },
      body: JSON.stringify({
        model: opts.model,
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user },
        ],
        temperature: 0.1,
        max_tokens: OPENROUTER_MAX_TOKENS,
        reasoning: { enabled: false, exclude: true },
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return empty(`OpenRouter HTTP ${res.status}: ${body.slice(0, 200)}`, 'failed');
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string; reasoning?: string } }[];
      error?: { message?: string };
    };
    if (data.error?.message) {
      return empty(`OpenRouter error: ${data.error.message}`, 'failed');
    }
    const message = data.choices?.[0]?.message;
    raw = message?.content || message?.reasoning || '';
    if (!raw) {
      return empty('OpenRouter returned empty content', 'failed');
    }
  } catch (err) {
    clearTimeout(timer);
    return empty(
      `OpenRouter request failed: ${err instanceof Error ? err.message : String(err)}`,
      'failed'
    );
  }

  const { verdicts, parseMode } = parseRerankResponse(raw, batch.length);
  // Translate 1-based positional indices back to the candidate's original
  // index in the caller's array (positional i=1 means batch[0].index).
  const translated = new Map<number, Verdict>();
  for (const [positional, verdict] of verdicts) {
    const cand = batch[positional];
    if (cand) translated.set(cand.index, verdict);
  }

  const rejectedCount = [...translated.values()].filter((v) => v === 'N').length;

  const result: RerankResult = {
    verdicts: translated,
    parsedCount: translated.size,
    parseMode,
    durationMs: Date.now() - t0,
    batchSize: batch.length,
    rejectedCount,
    error: null,
  };

  log.info(`rerank batch complete`, {
    phase: 'video-discover.rerank',
    batch_size: result.batchSize,
    parsed_count: result.parsedCount,
    parse_mode: result.parseMode,
    rejected_count: result.rejectedCount,
    duration_ms: result.durationMs,
  });

  return result;
}

// ============================================================================
// Prompt construction
// ============================================================================

interface BuildPromptOpts {
  candidates: RerankCandidate[];
  centerGoal: string;
  subGoal?: string;
  language: string;
}

export function buildRerankPrompt(opts: BuildPromptOpts): { system: string; user: string } {
  const isKorean = opts.language.startsWith('ko');

  const system = isKorean
    ? [
        '당신은 학습 영상 품질을 판정하는 편집자입니다.',
        '각 영상이 학습 목표에 실질적으로 도움이 되는 교육 콘텐츠인지 판정합니다.',
        '광고, PPL, 협찬, 제품 리뷰, 브이로그, 엔터테인먼트, 드라마는 N으로 판정합니다.',
        '강의, 튜토리얼, 해설, 경험 공유, 학습법, 실습 영상은 Y로 판정합니다.',
        '응답은 반드시 JSON 배열 형식으로만 출력하세요. 다른 텍스트 금지.',
        '예: [{"i":1,"v":"Y"},{"i":2,"v":"N"},{"i":3,"v":"Y"}]',
      ].join(' ')
    : [
        'You are an editor judging learning video quality.',
        'For each video, decide if it is genuinely helpful educational content for the learning goal.',
        'Ads, PPL, sponsored content, product reviews, vlogs, entertainment, drama → N.',
        'Lectures, tutorials, explanations, experience reports, learning methods, practice → Y.',
        'Respond with a JSON array only. No other text.',
        'Example: [{"i":1,"v":"Y"},{"i":2,"v":"N"},{"i":3,"v":"Y"}]',
      ].join(' ');

  const lines = opts.candidates.map((c, idx) => {
    const num = idx + 1;
    const title = c.title.length > 140 ? c.title.slice(0, 140) + '…' : c.title;
    const channel = c.channel.length > 40 ? c.channel.slice(0, 40) : c.channel;
    return `${num}. ${title} / ${channel}`;
  });

  const header = isKorean
    ? `중심 목표: "${opts.centerGoal}"${opts.subGoal ? `\n세부 목표: "${opts.subGoal}"` : ''}\n\n다음 영상을 판정하세요:`
    : `Center goal: "${opts.centerGoal}"${opts.subGoal ? `\nSub goal: "${opts.subGoal}"` : ''}\n\nJudge the following videos:`;

  const footer = isKorean
    ? `\n\n위 ${opts.candidates.length}개 영상에 대해 JSON 배열로만 답변하세요.`
    : `\n\nRespond with a JSON array for all ${opts.candidates.length} videos.`;

  return {
    system,
    user: `${header}\n${lines.join('\n')}${footer}`,
  };
}

// ============================================================================
// Response parsing — strict JSON → regex fallback → empty map
// ============================================================================

/**
 * Parse the model's verdict response. Returns a map with 1-based positional
 * indices (matching the prompt's numbering) → verdict. The caller is
 * responsible for translating positional to original-array index.
 *
 * 3 defensive layers:
 *   1. Strict JSON: parse the first balanced `[...]` array, read `{i,v}` entries
 *   2. Regex fallback: scan the raw text for `i=N v=Y/N` patterns in any shape
 *   3. Empty map: caller defaults to KEEP (pass-through)
 */
export function parseRerankResponse(
  raw: string,
  batchSize: number
): { verdicts: Map<number, Verdict>; parseMode: 'json' | 'regex' | 'failed' } {
  const verdicts = new Map<number, Verdict>();

  // ── Layer 1: strict JSON via balanced-array extraction ────────────
  const extracted = extractFirstJsonArray(raw);
  if (Array.isArray(extracted)) {
    for (const item of extracted) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      const iRaw = rec['i'];
      const vRaw = rec['v'];
      const i = typeof iRaw === 'number' ? iRaw : parseInt(String(iRaw ?? ''), 10);
      const v = String(vRaw ?? '')
        .trim()
        .toUpperCase();
      if (!Number.isInteger(i) || i < 1 || i > batchSize) continue;
      if (v !== 'Y' && v !== 'N') continue;
      // i is 1-based; store as 0-based for downstream lookup
      verdicts.set(i - 1, v as Verdict);
    }
    if (verdicts.size > 0) return { verdicts, parseMode: 'json' };
  }

  // ── Layer 2: regex fallback — catches loose formats ───────────────
  // Matches patterns like:
  //   {"i":1,"v":"Y"}        (JSON-ish)
  //   1: Y, 2: N, 3: Y       (colon list)
  //   1. Y 2. N              (numbered)
  //   i=1 v=Y               (equals)
  //
  // Regex is deliberately permissive — we accept anything that looks like
  // "integer then Y or N" in close proximity.
  const pairRegex =
    /(?:["']?i["']?\s*[:=]\s*)?(\d{1,3})\s*[:,.)\-"'\s]{1,8}(?:["']?v["']?\s*[:=]\s*)?["']?([YNyn])["']?/g;
  let m: RegExpExecArray | null;
  while ((m = pairRegex.exec(raw)) !== null) {
    const iRaw = m[1];
    const vRaw = m[2];
    if (!iRaw || !vRaw) continue;
    const i = parseInt(iRaw, 10);
    const v = vRaw.toUpperCase();
    if (!Number.isFinite(i) || i < 1 || i > batchSize) continue;
    if (v !== 'Y' && v !== 'N') continue;
    // First match wins — don't overwrite on duplicate indices
    if (!verdicts.has(i - 1)) {
      verdicts.set(i - 1, v as Verdict);
    }
  }
  if (verdicts.size > 0) return { verdicts, parseMode: 'regex' };

  return { verdicts, parseMode: 'failed' };
}

/**
 * Find the first balanced `[...]` JSON array anywhere in the text and parse
 * it. Mirrors the helper in `llm-query-generator.ts` — duplicated here to
 * avoid a cross-module export (keeping the rerank module self-contained).
 */
function extractFirstJsonArray(content: string): unknown | null {
  // Try the simple path first: content IS a JSON array
  try {
    const direct = JSON.parse(content);
    if (Array.isArray(direct)) return direct;
    // Object wrapper with a single array value
    if (direct && typeof direct === 'object') {
      for (const v of Object.values(direct)) {
        if (Array.isArray(v)) return v;
      }
    }
  } catch {
    // fall through to manual extraction
  }

  const start = content.indexOf('[');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < content.length; i++) {
    const ch = content[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '[') depth += 1;
    else if (ch === ']') {
      depth -= 1;
      if (depth === 0) {
        const candidate = content.slice(start, i + 1);
        try {
          return JSON.parse(candidate);
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
