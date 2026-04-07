/**
 * Mandala AI Generator
 *
 * Calls the mandala-gen v13 model (Ollama) to generate 9x9 mandala charts from a goal.
 * Model is served on Mac Mini via Ollama API.
 *
 * Related: docs/research/mandala-model-eval-v14.md
 */

import { config } from '../../config';
import { logger } from '../../utils/logger';
import { MemoryCache } from '../../utils/memory-cache';
import { searchMandalasByGoal, formatMandalasForFewShot } from './search';
import { OpenRouterGenerationProvider } from '../llm/openrouter';

// ─── Types ───

export interface MandalaGenerateInput {
  goal: string;
  domain?: string;
  language?: 'ko' | 'en';
}

export interface GeneratedMandala {
  center_goal: string;
  center_label: string;
  language: string;
  domain: string;
  sub_goals: string[];
  sub_labels?: string[];
  actions: Record<string, string[]>;
}

// ─── Constants ───

const MANDALA_GEN_TIMEOUT_MS = 600_000; // 10 min upper bound (Mac Mini M4 typical ~80s)
// Empirically v13 outputs ~1100-1700 tokens for a full mandala. 2500 gives a comfortable margin
// without wasting time on speculative buffer (was 5000 — over-allocated by 3x).
const NUM_PREDICT = 2_500;
const TEMPERATURE = 0.7;

// ─── In-memory result cache ───
//
// Caches generated mandalas keyed by normalized goal text.
// Eliminates redundant LoRA calls for identical/repeated user input.
// Cache key: `${language}:${normalizedGoal}` — exact match only.
// (Future: embedding-based cosine ≥ 0.9 hit — issue tracked separately.)

const GENERATE_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const GENERATE_CACHE_MAX = 200;

interface CachedGeneration {
  mandala: GeneratedMandala;
  source: 'lora' | 'llm-fallback';
}

const generationCache = new MemoryCache<CachedGeneration>({
  defaultTTLMs: GENERATE_CACHE_TTL_MS,
  maxEntries: GENERATE_CACHE_MAX,
});

function buildCacheKey(input: MandalaGenerateInput): string {
  const lang = input.language ?? 'ko';
  const domain = input.domain ?? 'general';
  const normalized = input.goal.trim().toLowerCase().replace(/\s+/g, ' ');
  return `${lang}:${domain}:${normalized}`;
}

/** Public: lookup cached mandala. Returns null on miss. */
export function getCachedMandala(input: MandalaGenerateInput): CachedGeneration | null {
  return generationCache.get(buildCacheKey(input));
}

/** Public: store generated mandala in cache. */
export function setCachedMandala(input: MandalaGenerateInput, value: CachedGeneration): void {
  generationCache.set(buildCacheKey(input), value);
}

// ─── Prompt Template (matches v13 training format) ───

function buildPrompt(input: MandalaGenerateInput): string {
  const lang = input.language ?? 'ko';
  const domain = input.domain ?? 'general';

  const instruction =
    lang === 'ko'
      ? `다음 목표에 대한 만다라트를 생성하세요: ${input.goal}`
      : `Generate a Mandalart chart for the following goal: ${input.goal}`;

  return `### Instruction:\n${instruction}\n### Input:\n도메인: ${domain}\n언어: ${lang}\n### Output:\n`;
}

// ─── Robust JSON Parser v4.1 (Devin, 5/5 PASS) ───
// Source: mandala-diagnostic-v13-fixed.ipynb + v4.1 improvements

/** Fix `[HIGH)` → `[HIGH]` bracket typo produced by the model */
function fixBracketTypos(text: string): string {
  return text.replace(/\[(HIGH|MEDIUM|LOW|MID|NORMAL)\)/g, '[$1]');
}

/** Remove `output` field that often contains unescaped newlines */
function removeOutputField(text: string): string {
  const match = text.match(/,\s*"output"\s*:\s*"/);
  if (match && match.index !== undefined) {
    return text.slice(0, match.index);
  }
  return text;
}

/** Escape unescaped newlines inside JSON string values (tracks string context) */
function escapeInnerNewlines(text: string): string {
  let result = '';
  let inStr = false;
  let esc = false;
  for (const ch of text) {
    if (esc) {
      result += ch;
      esc = false;
      continue;
    }
    if (ch === '\\' && inStr) {
      result += ch;
      esc = true;
      continue;
    }
    if (ch === '"') {
      inStr = !inStr;
      result += ch;
      continue;
    }
    if (inStr && (ch === '\n' || ch === '\r')) {
      result += ch === '\n' ? '\\n' : '\\r';
      continue;
    }
    result += ch;
  }
  return result;
}

/** Remove bare trailing arrays (e.g., `] ["label1", ...]` without key) — string-aware */
function removeBareTrailingArrays(text: string): string {
  // Find the last top-level `}` and truncate anything after it if it starts with `[`
  let depth = 0;
  let inStr = false;
  let esc = false;
  let lastTopLevelClose = -1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (ch === '\\' && inStr) {
      esc = true;
      continue;
    }
    if (ch === '"') {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0 && ch === '}') lastTopLevelClose = i;
    }
  }

  if (lastTopLevelClose === -1) return text;
  // Check if there's a bare array after the last close
  const trailing = text.slice(lastTopLevelClose + 1).trimStart();
  if (trailing.startsWith('[')) {
    return text.slice(0, lastTopLevelClose + 1);
  }
  return text;
}

/** Count unclosed brackets in a prefix (string-aware) */
function closeBrackets(truncated: string): string {
  const stack: string[] = [];
  let inStr = false;
  let esc = false;
  for (const ch of truncated) {
    if (esc) {
      esc = false;
      continue;
    }
    if (ch === '\\' && inStr) {
      esc = true;
      continue;
    }
    if (ch === '"') {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if ((ch === '}' || ch === ']') && stack.length > 0 && stack[stack.length - 1] === ch) {
      stack.pop();
    }
  }
  let result = truncated;
  while (stack.length > 0) result += stack.pop();
  return result;
}

function extractJsonRobust(text: string): GeneratedMandala | null {
  const start = text.indexOf('{');
  if (start === -1) return null;

  // Stop token cleanup
  let cleaned = text;
  for (const stop of ['### END', '### Instruction', '### Input:']) {
    const idx = cleaned.indexOf(stop);
    if (idx > 0) cleaned = cleaned.slice(0, idx);
  }
  cleaned = cleaned.trim();

  // Fragment from first `{`
  let fragment = cleaned.slice(cleaned.indexOf('{'));

  // v4.1 preprocessing pipeline
  fragment = fixBracketTypos(fragment);
  fragment = removeOutputField(fragment);
  fragment = escapeInnerNewlines(fragment);
  fragment = removeBareTrailingArrays(fragment);

  // Method 1: Direct parse
  try {
    return JSON.parse(fragment) as GeneratedMandala;
  } catch {
    // continue to fallback
  }

  // Method 2: Reverse search for last `}` that parses
  for (let pos = fragment.length - 1; pos > 0; pos--) {
    if (fragment[pos] === '}') {
      try {
        return JSON.parse(fragment.slice(0, pos + 1)) as GeneratedMandala;
      } catch {
        continue;
      }
    }
  }

  // Method 3: Truncation repair — find last complete item, close brackets
  const cutPatterns = ['", ', '",\n', '"]', '"}'];
  let bestCut = -1;
  for (const pattern of cutPatterns) {
    const idx = fragment.lastIndexOf(pattern);
    if (idx > bestCut) bestCut = idx + pattern.length;
  }

  if (bestCut > 0) {
    let truncated = fragment.slice(0, bestCut).trimEnd();
    if (truncated.endsWith(',')) truncated = truncated.slice(0, -1);
    truncated = closeBrackets(truncated);

    try {
      return JSON.parse(truncated) as GeneratedMandala;
    } catch {
      // final fallback failed
    }
  }

  return null;
}

/**
 * Post-process: only fill center_label when missing (simple truncation).
 * Do NOT auto-fill sub_labels — let the client decide whether to fetch
 * proper short labels via generateLabels (OpenRouter), since truncated
 * sub_goals look ugly in mini grid cells.
 */
function enrichLabels(m: GeneratedMandala): GeneratedMandala {
  if (!m.center_label && m.center_goal) {
    m.center_label = m.center_goal.length > 20 ? m.center_goal.slice(0, 20) : m.center_goal;
  }
  return m;
}

// ─── Validation ───

function validateMandala(m: GeneratedMandala): { valid: boolean; reason?: string } {
  if (!m.center_goal && !m.center_label) {
    return { valid: false, reason: 'missing center_goal and center_label' };
  }
  if (!Array.isArray(m.sub_goals) || m.sub_goals.length !== 8) {
    return { valid: false, reason: `sub_goals count: ${m.sub_goals?.length ?? 0}/8` };
  }
  if (!m.actions || typeof m.actions !== 'object') {
    return { valid: false, reason: 'missing actions object' };
  }
  const totalActions = Object.values(m.actions).reduce(
    (sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0),
    0
  );
  if (totalActions < 56) {
    // Allow some flexibility (7/8 per sub_goal minimum)
    return { valid: false, reason: `actions count: ${totalActions}/64 (minimum 56)` };
  }
  return { valid: true };
}

// ─── Generator ───

export async function generateMandala(input: MandalaGenerateInput): Promise<GeneratedMandala> {
  const url = config.mandalaGen.url;
  const model = config.mandalaGen.model;

  if (!url) {
    throw new MandalaGenError('MANDALA_GEN_URL not configured', 'SERVICE_UNAVAILABLE');
  }

  const prompt = buildPrompt(input);

  logger.info(`Mandala generation started: goal="${input.goal}" model=${model}`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MANDALA_GEN_TIMEOUT_MS);

  try {
    const response = await fetch(`${url}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        options: {
          num_predict: NUM_PREDICT,
          temperature: TEMPERATURE,
          top_p: 0.9,
        },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errorBody = await response.text();
      throw new MandalaGenError(
        `Ollama API error ${response.status}: ${errorBody}`,
        'SERVICE_UNAVAILABLE'
      );
    }

    const data = (await response.json()) as {
      response?: string;
      total_duration?: number;
    };

    const raw = data.response;
    if (!raw) {
      throw new MandalaGenError('Ollama returned empty response', 'GENERATION_FAILED');
    }

    const durationSec = (data.total_duration ?? 0) / 1e9;
    logger.info(
      `Ollama response received: goal="${input.goal}" duration=${durationSec.toFixed(1)}s`
    );

    // Parse JSON (v4.1 robust parser)
    const parsed = extractJsonRobust(raw);
    if (!parsed) {
      logger.error(`Failed to parse mandala JSON: ${raw.slice(0, 500)}`);
      throw new MandalaGenError('Failed to parse generated mandala JSON', 'PARSE_FAILED');
    }

    // Post-process: auto-generate missing center_label / sub_labels
    const mandala = enrichLabels(parsed);

    // Validate structure
    const validation = validateMandala(mandala);
    if (!validation.valid) {
      logger.warn(`Generated mandala validation failed: ${validation.reason} goal="${input.goal}"`);
      throw new MandalaGenError(
        `Generated mandala is incomplete: ${validation.reason}`,
        'VALIDATION_FAILED'
      );
    }

    const totalActions = Object.values(mandala.actions).reduce(
      (s, a) => s + (Array.isArray(a) ? a.length : 0),
      0
    );
    logger.info(
      `Mandala generation complete: goal="${input.goal}" subs=${mandala.sub_goals.length} actions=${totalActions} duration=${durationSec.toFixed(1)}s`
    );

    return mandala;
  } catch (err) {
    clearTimeout(timeout);

    if (err instanceof MandalaGenError) throw err;

    if (err instanceof Error && err.name === 'AbortError') {
      throw new MandalaGenError('Mandala generation timed out', 'TIMEOUT');
    }

    // Connection refused = Ollama not running
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('ECONNREFUSED') || message.includes('fetch failed')) {
      throw new MandalaGenError(
        `Cannot reach mandala generation server at ${url}`,
        'SERVICE_UNAVAILABLE'
      );
    }

    throw new MandalaGenError(message, 'GENERATION_FAILED');
  }
}

// ─── Tier 3 Fallback: Few-shot LLM generation via OpenRouter ───

/**
 * Fallback generator: when LoRA fails, use embedding search for few-shot examples
 * and call OpenRouter LLM to generate the mandala.
 */
export async function generateMandalaWithFallback(
  input: MandalaGenerateInput
): Promise<GeneratedMandala> {
  logger.info(`Mandala fallback (Tier 3) started: goal="${input.goal}"`);

  // Step 1: Retrieve similar mandalas as few-shot examples
  const similar = await searchMandalasByGoal(input.goal, {
    limit: 3,
    threshold: 0.4,
    language: input.language,
  });

  if (similar.length === 0) {
    throw new MandalaGenError(
      'No similar mandalas found for few-shot fallback',
      'GENERATION_FAILED'
    );
  }

  const examples = formatMandalasForFewShot(similar).join('\n\n');
  const lang = input.language ?? 'ko';
  const domain = input.domain ?? 'general';

  const systemInstruction =
    lang === 'ko'
      ? '당신은 만다라트 차트 전문가입니다. 주어진 목표에 대해 9x9 만다라트 차트를 JSON으로 생성합니다.'
      : 'You are a Mandalart chart expert. Generate a 9x9 mandala chart in JSON for the given goal.';

  const prompt = `${systemInstruction}

Here are similar existing mandalas as reference examples:

${examples}

Now generate a new mandala for the goal below. Output ONLY a valid JSON object with this exact structure:
{"center_goal": "...", "center_label": "short label", "language": "${lang}", "domain": "${domain}", "sub_goals": ["8 items"], "actions": {"sub_goal_1": ["8 items per sub_goal"], ...}}

Goal: ${input.goal}
Domain: ${domain}
Language: ${lang}
`;

  const provider = new OpenRouterGenerationProvider();
  const raw = await provider.generate(prompt, {
    temperature: 0.7,
    maxTokens: NUM_PREDICT,
    format: 'json',
  });

  const parsed = extractJsonRobust(raw);
  if (!parsed) {
    logger.error(`Tier 3 fallback: failed to parse LLM JSON: ${raw.slice(0, 500)}`);
    throw new MandalaGenError('Tier 3 fallback: failed to parse LLM output', 'PARSE_FAILED');
  }

  const mandala = enrichLabels(parsed);
  const validation = validateMandala(mandala);
  if (!validation.valid) {
    throw new MandalaGenError(
      `Tier 3 fallback: validation failed: ${validation.reason}`,
      'VALIDATION_FAILED'
    );
  }

  logger.info(
    `Mandala fallback (Tier 3) complete: goal="${input.goal}" subs=${mandala.sub_goals.length} examples=${similar.length}`
  );
  return mandala;
}

// ─── Label Generator (OpenRouter) ───
//
// Used as a fallback when search results or AI-generated mandalas lack short labels.
// Produces { center_label, sub_labels[] } from a goal + sub-goal list.

export interface LabelGenerateInput {
  center_goal: string;
  sub_goals: string[];
  language?: 'ko' | 'en';
}

export interface GeneratedLabels {
  center_label: string;
  sub_labels: string[];
}

const LABEL_MAX_TOKENS = 800;

function buildLabelPrompt(input: LabelGenerateInput): string {
  const lang = input.language ?? 'ko';
  const subList = input.sub_goals.map((g, i) => `  ${i + 1}. ${g}`).join('\n');

  if (lang === 'ko') {
    return `다음 목표와 하위 목표들을 2-4글자 짧은 라벨로 변환해.
center_label은 5글자 이내, sub_labels 각각은 2-4글자.

center_goal: "${input.center_goal}"
sub_goals:
${subList}

반드시 JSON으로만 응답:
{ "center_label": "짧은라벨", "sub_labels": ["라벨1", "라벨2", ...] }`;
  }

  return `Convert the following goal and sub-goals into short 2-4 character labels.
center_label max 5 chars, each sub_label 2-4 chars.

center_goal: "${input.center_goal}"
sub_goals:
${subList}

Respond ONLY with JSON:
{ "center_label": "shortLabel", "sub_labels": ["lbl1", "lbl2", ...] }`;
}

export async function generateLabels(input: LabelGenerateInput): Promise<GeneratedLabels> {
  if (!input.center_goal || !Array.isArray(input.sub_goals) || input.sub_goals.length === 0) {
    throw new MandalaGenError('center_goal and sub_goals are required', 'GENERATION_FAILED');
  }

  logger.info(
    `Label generation started: goal="${input.center_goal}" subs=${input.sub_goals.length}`
  );

  const prompt = buildLabelPrompt(input);
  const provider = new OpenRouterGenerationProvider();
  const raw = await provider.generate(prompt, {
    temperature: 0.3,
    maxTokens: LABEL_MAX_TOKENS,
    format: 'json',
  });

  // Extract JSON
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    logger.error(`Label generation: invalid JSON response: ${raw.slice(0, 300)}`);
    throw new MandalaGenError('Label generation: invalid JSON', 'PARSE_FAILED');
  }

  let parsed: GeneratedLabels;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch (err) {
    logger.error(`Label generation: parse failed: ${err}`);
    throw new MandalaGenError('Label generation: parse failed', 'PARSE_FAILED');
  }

  if (!parsed.center_label || !Array.isArray(parsed.sub_labels)) {
    throw new MandalaGenError('Label generation: missing fields', 'VALIDATION_FAILED');
  }

  // Trim to expected lengths defensively
  parsed.center_label = parsed.center_label.slice(0, 8);
  parsed.sub_labels = parsed.sub_labels.slice(0, input.sub_goals.length).map((l) => l.slice(0, 6));

  logger.info(
    `Label generation complete: center="${parsed.center_label}" subs=${parsed.sub_labels.length}`
  );
  return parsed;
}

// ─── Error class ───

export type MandalaGenErrorCode =
  | 'SERVICE_UNAVAILABLE'
  | 'GENERATION_FAILED'
  | 'PARSE_FAILED'
  | 'VALIDATION_FAILED'
  | 'TIMEOUT';

export class MandalaGenError extends Error {
  constructor(
    message: string,
    public readonly code: MandalaGenErrorCode
  ) {
    super(message);
    this.name = 'MandalaGenError';
  }
}
