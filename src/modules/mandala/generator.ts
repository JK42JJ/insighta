/**
 * Mandala AI Generator
 *
 * Calls the mandala-gen v13 model (Ollama) to generate 9x9 mandala charts from a goal.
 * Model is served on Mac Mini via Ollama API.
 *
 * Related: docs/research/mandala-model-eval-v14.md
 */

import type { Prisma } from '@prisma/client';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import { MemoryCache } from '../../utils/memory-cache';
import { getPrismaClient } from '../database/client';
import { searchMandalasByGoal, formatMandalasForFewShot } from './search';
import { OpenRouterGenerationProvider } from '../llm/openrouter';
import {
  buildStructurePrompt,
  STRUCTURE_MODEL,
  STRUCTURE_TEMPERATURE,
  STRUCTURE_MAX_TOKENS as PROMPT_STRUCTURE_MAX_TOKENS,
} from '@/prompts/structure-generator';
import {
  buildActionsPrompt,
  ACTIONS_MODEL,
  ACTIONS_TEMPERATURE,
  ACTIONS_MAX_TOKENS as PROMPT_ACTIONS_MAX_TOKENS,
} from '@/prompts/actions-generator';

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
  source: 'lora' | 'llm-fallback' | 'haiku';
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

  const inputMeta =
    lang === 'ko' ? `도메인: ${domain}\n언어: ${lang}` : `Domain: ${domain}\nLanguage: ${lang}`;

  return `### Instruction:\n${instruction}\n### Input:\n${inputMeta}\n### Output:\n`;
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
async function enrichLabels(m: GeneratedMandala): Promise<GeneratedMandala> {
  if (!m.center_label && m.center_goal) {
    m.center_label = m.center_goal.length > 20 ? m.center_goal.slice(0, 20) : m.center_goal;
  }
  if (!m.sub_labels || m.sub_labels.length === 0) {
    try {
      const lang = m.language === 'ko' || m.language === 'en' ? m.language : 'en';
      const labels = await generateLabels({
        center_goal: m.center_goal,
        sub_goals: m.sub_goals,
        language: lang,
      });
      m.center_label = labels.center_label;
      m.sub_labels = labels.sub_labels;
    } catch (err) {
      // Label generation failed — leave sub_labels empty.
      // UI falls back to sub_goals. NEVER truncate sub_goals as labels.
      logger.warn(`enrichLabels: sub_labels generation failed, leaving empty: ${err}`);
    }
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

export async function generateMandala(
  input: MandalaGenerateInput,
  externalSignal?: AbortSignal
): Promise<GeneratedMandala> {
  const url = config.mandalaGen.url;
  const model = config.mandalaGen.model;

  if (!url) {
    throw new MandalaGenError('MANDALA_GEN_URL not configured', 'SERVICE_UNAVAILABLE');
  }

  const prompt = buildPrompt(input);

  logger.info(`Mandala generation started: goal="${input.goal}" model=${model}`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MANDALA_GEN_TIMEOUT_MS);

  // Forward external abort (race-fallback discarding the LoRA loser) into
  // the same controller so the in-flight Ollama fetch is cancelled too.
  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  try {
    const response = await fetch(`${url}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        // Keep model resident in VRAM/RAM for 24h after each call.
        // Without this, Mac Mini Ollama uses default 5min TTL → cold-start
        // (~45s reload) on next request after idle, blowing past FE timeout.
        keep_alive: '24h',
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

    // HARD RULE: Always use the user's original goal as center_goal.
    // LLMs/LoRA frequently rewrite/expand the goal despite prompt instructions.
    parsed.center_goal = input.goal;

    // Post-process: auto-generate missing center_label / sub_labels
    const mandala = await enrichLabels(parsed);

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
      // Distinguish "race lost / external cancel" from "internal timeout".
      if (externalSignal?.aborted) {
        throw new MandalaGenError('Mandala generation cancelled', 'TIMEOUT');
      }
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
  } finally {
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }
}

// ─── Primary Generator: Two-phase Haiku generation ───
//
// Phase 1 (user-facing, ~3s): Structure only — center + 8 sub_goals + labels
// Phase 2 (background): Actions — 8×8 = 64 action items
//
// This split reduces user wait from ~25s to ~3s.

const HAIKU_MODEL = 'anthropic/claude-haiku-4.5'; // Used by generateMandalaWithHaiku (legacy)

/**
 * Phase 1: Generate mandala STRUCTURE only (center + sub_goals + labels).
 * ~300 tokens output → ~2-3s. No actions — those come in Phase 2.
 */
export async function generateMandalaStructure(
  input: MandalaGenerateInput
): Promise<GeneratedMandala> {
  const t0 = Date.now();
  logger.info(`Mandala structure generation started: goal="${input.goal}"`);

  const similar = await searchMandalasByGoal(input.goal, {
    limit: 1,
    threshold: 0.4,
    language: input.language,
  });

  const t1 = Date.now();
  logger.info(`[TIMING] structure-search: ${t1 - t0}ms`);

  const lang = input.language ?? 'ko';
  const domain = input.domain ?? 'general';

  // Minimal few-shot: structure only (no actions)
  const ref = similar[0];
  const reference = ref
    ? `Reference:\n{"center_goal":"${ref.center_goal}","center_label":"${ref.center_label ?? ''}","sub_goals":${JSON.stringify((ref.sub_goals ?? []).slice(0, 4))},"sub_labels":${JSON.stringify((ref.sub_labels ?? []).slice(0, 4))}}`
    : undefined;

  // Phase 2: prompt from src/prompts/structure-generator.ts
  const prompt = buildStructurePrompt({
    goal: input.goal,
    domain,
    language: lang,
    reference,
  });

  const provider = new OpenRouterGenerationProvider(STRUCTURE_MODEL);
  const raw = await provider.generate(prompt, {
    temperature: STRUCTURE_TEMPERATURE,
    maxTokens: PROMPT_STRUCTURE_MAX_TOKENS,
    format: 'json',
  });

  const t2 = Date.now();
  logger.info(`[TIMING] structure-generate: ${t2 - t1}ms | total: ${t2 - t0}ms`);

  const parsed = extractJsonRobust(raw);
  if (!parsed) {
    throw new MandalaGenError('Structure generation: failed to parse JSON', 'PARSE_FAILED');
  }

  if (!parsed.center_goal || !Array.isArray(parsed.sub_goals) || parsed.sub_goals.length !== 8) {
    throw new MandalaGenError(
      `Structure generation: invalid — sub_goals=${parsed.sub_goals?.length ?? 0}`,
      'VALIDATION_FAILED'
    );
  }

  // HARD RULE: Always use the user's original goal as center_goal.
  // LLMs frequently rewrite/expand the goal despite prompt instructions.
  // The user's input is the source of truth — never let LLM override it.
  parsed.center_goal = input.goal;

  // Ensure actions exists (empty — Phase 2 fills it)
  if (!parsed.actions) parsed.actions = {};
  if (!parsed.language) parsed.language = lang;
  if (!parsed.domain) parsed.domain = domain;

  return parsed;
}

/**
 * Phase 2: Generate actions for all sub_goals (background, ~10-15s).
 * Called after mandala creation — user doesn't wait for this.
 */
export async function generateMandalaActions(
  subGoals: string[],
  language: string = 'en',
  centerGoal?: string,
  focusTags?: string[],
  targetLevel?: string
): Promise<Record<string, string[]>> {
  const t0 = Date.now();
  logger.info(`Mandala actions generation started: ${subGoals.length} sub_goals`);

  // Phase 2: prompt from src/prompts/actions-generator.ts
  const prompt = buildActionsPrompt({
    centerGoal: centerGoal ?? '',
    subGoals,
    language,
    focusTags,
    targetLevel,
  });

  const provider = new OpenRouterGenerationProvider(ACTIONS_MODEL);
  const raw = await provider.generate(prompt, {
    temperature: ACTIONS_TEMPERATURE,
    maxTokens: PROMPT_ACTIONS_MAX_TOKENS,
    format: 'json',
  });

  const t1 = Date.now();
  logger.info(`[TIMING] actions-generate: ${t1 - t0}ms`);

  const parsed = extractJsonRobust(raw) as Record<string, string[]> | null;
  if (!parsed) {
    throw new MandalaGenError('Actions generation: failed to parse JSON', 'PARSE_FAILED');
  }

  return parsed;
}

/**
 * Full mandala generator (legacy — kept for LoRA background + cache).
 * Uses few-shot examples + generates everything in one shot (~20-25s).
 */
export async function generateMandalaWithHaiku(
  input: MandalaGenerateInput,
  externalSignal?: AbortSignal
): Promise<GeneratedMandala> {
  const t0 = Date.now();
  logger.info(`Mandala generation (Haiku) started: goal="${input.goal}"`);

  // Step 1: Retrieve similar mandalas as few-shot examples
  const similar = await searchMandalasByGoal(input.goal, {
    limit: 1,
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

  const rules =
    lang === 'ko'
      ? `규칙:
- center_goal: 사용자가 입력한 목표를 그대로 사용. 절대 재작성/확장/축약하지 말 것.
- center_label: center_goal의 2-4단어 요약
- sub_goals: center_goal 달성을 위한 8개 구체적 영역 (모호한 카테고리 금지)
- sub_labels: 각 sub_goal의 짧은 약어 (최대 10자)
  의미를 반드시 보존. 앞글자 자르기 절대 금지 (예: "자원관리" O, "자원 관" X)
- actions: sub_goal당 8개 구체적이고 측정 가능한 실행 단계
  각 action은 실행하고 체크할 수 있는 것이어야 함

출력: JSON만. 마크다운/설명 없음.
{"center_goal":"...","center_label":"...","language":"ko",
"domain":"${domain}","sub_goals":["8개"],"sub_labels":["8개"],
"actions":{"0":["8개"],"1":["8개"],...,"7":["8개"]}}`
      : `RULES:
- center_goal: Use the user's goal EXACTLY as given. NEVER rewrite, expand, or shorten it.
- center_label: 2-4 word summary of center_goal
- sub_goals: 8 distinct areas that TOGETHER achieve the center goal. Must be specific and actionable, not vague categories
- sub_labels: Short abbreviation for each sub_goal. EN max 15 chars. MUST capture meaning. NEVER truncate (e.g. "Understa" is WRONG). Example: "Understand Core Principles" → "Core Principles"
- actions: 8 concrete, measurable steps per sub_goal. Each action must be something you can DO and CHECK OFF

OUTPUT: JSON only, no markdown, no explanation.
{"center_goal":"...","center_label":"...","language":"en",
"domain":"${domain}","sub_goals":["8 items"],"sub_labels":["8 items"],
"actions":{"0":["8 items"],"1":["8 items"],...,"7":["8 items"]}}`;

  const refHeader = lang === 'ko' ? '참고 예시:' : 'Reference example:';

  const goalLabel = lang === 'ko' ? '목표' : 'Goal';

  const prompt = `${lang === 'ko' ? '만다라트 차트 전문가. 주어진 목표에 대해 만다라트 차트를 JSON으로 생성.' : 'You are a Mandalart chart expert. Generate a mandala chart in JSON.'}

${rules}

${refHeader}
${examples}

${goalLabel}: ${input.goal}
`;

  const t1 = Date.now();
  logger.info(`[TIMING] search: ${t1 - t0}ms`);

  const provider = new OpenRouterGenerationProvider(HAIKU_MODEL);
  const raw = await provider.generate(prompt, {
    temperature: 0.7,
    maxTokens: NUM_PREDICT,
    format: 'json',
    signal: externalSignal,
  });

  const t2 = Date.now();
  logger.info(`[TIMING] haiku-generate: ${t2 - t1}ms`);

  const parsed = extractJsonRobust(raw);
  if (!parsed) {
    logger.error(`Haiku generation: failed to parse JSON: ${raw.slice(0, 500)}`);
    throw new MandalaGenError('Haiku generation: failed to parse output', 'PARSE_FAILED');
  }

  // HARD RULE: Always use the user's original goal as center_goal.
  // LLMs frequently rewrite/expand the goal despite prompt instructions.
  parsed.center_goal = input.goal;

  const mandala = await enrichLabels(parsed);
  const t3 = Date.now();
  logger.info(`[TIMING] enrichLabels: ${t3 - t2}ms | total: ${t3 - t0}ms`);
  const validation = validateMandala(mandala);
  if (!validation.valid) {
    throw new MandalaGenError(
      `Haiku generation: validation failed: ${validation.reason}`,
      'VALIDATION_FAILED'
    );
  }

  logger.info(
    `Mandala generation (Haiku) complete: goal="${input.goal}" subs=${mandala.sub_goals.length} examples=${similar.length}`
  );
  return mandala;
}

// ─── Label Generator (Anthropic Claude Haiku) ───
//
// Generates meaningful short labels from sub-goals using Claude Haiku.
// NEVER truncates sub_goals — always generates new abbreviations via LLM.
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
const EN_SUB_LABEL_MAX = 15;
const KO_SUB_LABEL_MAX = 10;

function buildLabelPrompt(input: LabelGenerateInput): string {
  const lang = input.language ?? 'en';
  const subList = input.sub_goals.map((g, i) => `  ${i + 1}. ${g}`).join('\n');

  if (lang === 'ko') {
    return `다음 목표와 하위 목표들의 핵심 의미를 담은 짧은 라벨을 생성해.

규칙:
- center_label: ${KO_SUB_LABEL_MAX}글자 이내
- sub_labels: 각각 ${KO_SUB_LABEL_MAX}글자 이내
- 원문 앞글자를 자르면 안 됨. 의미를 보존하는 새로운 약어를 만들어야 함
- 예시: "자원 관리 능력 개발" → "자원관리" (O), "자원 관리" → (X 잘라쓰기)

center_goal: "${input.center_goal}"
sub_goals:
${subList}

반드시 JSON으로만 응답:
{ "center_label": "짧은라벨", "sub_labels": ["라벨1", "라벨2", ...] }`;
  }

  return `Generate short, meaningful labels that capture the CORE MEANING of each sub-goal.

Rules:
- center_label: max ${EN_SUB_LABEL_MAX} characters
- Each sub_label: max ${EN_SUB_LABEL_MAX} characters
- NEVER truncate the original text. Create a NEW meaningful abbreviation.
- Good: "Understand Core Principles" → "Core PM"
- Good: "Master Resource Management" → "Resources"
- Bad: "Understand Core Principles" → "Understa" (truncation = forbidden)

center_goal: "${input.center_goal}"
sub_goals:
${subList}

Respond ONLY with JSON:
{ "center_label": "shortLbl", "sub_labels": ["lbl1", "lbl2", ...] }`;
}

export async function generateLabels(input: LabelGenerateInput): Promise<GeneratedLabels> {
  if (!input.center_goal || !Array.isArray(input.sub_goals) || input.sub_goals.length === 0) {
    throw new MandalaGenError('center_goal and sub_goals are required', 'GENERATION_FAILED');
  }

  const lang = input.language ?? 'en';
  const maxLen = lang === 'ko' ? KO_SUB_LABEL_MAX : EN_SUB_LABEL_MAX;

  logger.info(
    `Label generation started (Haiku): goal="${input.center_goal}" subs=${input.sub_goals.length} lang=${lang}`
  );

  const prompt = buildLabelPrompt(input);
  const LABEL_MODEL = 'anthropic/claude-haiku-4.5';
  const provider = new OpenRouterGenerationProvider(LABEL_MODEL);
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

  // Enforce max length (trim if LLM exceeded, but never truncate to make labels)
  parsed.center_label = parsed.center_label.slice(0, maxLen);
  parsed.sub_labels = parsed.sub_labels
    .slice(0, input.sub_goals.length)
    .map((l) => l.slice(0, maxLen));

  logger.info(
    `Label generation complete (Haiku): center="${parsed.center_label}" subs=[${parsed.sub_labels.join(', ')}]`
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

// ─── Primary Generation Entrypoint ───
//
// Previously a LoRA + LLM race (30s LoRA budget). Now a direct Haiku call
// (~3s) — no race logic, no LoRA dependency. generateMandala() (LoRA) is
// kept below for potential future background data collection.

export interface RaceResult {
  mandala: GeneratedMandala;
  source: 'lora' | 'llm-fallback' | 'haiku';
  /** Wall-clock duration in milliseconds (generation start → resolved). */
  duration_ms: number;
}

// ─── Quality metrics ───

/**
 * distinct(actions) / total(actions). 1.0 means every action is unique;
 * lower values flag the LoRA "repetition" failure mode where the model
 * keeps spitting the same line.
 */
function computeActionUniqueRate(actions: Record<string, string[]> | undefined): number | null {
  if (!actions) return null;
  const all: string[] = [];
  for (const arr of Object.values(actions)) {
    if (Array.isArray(arr)) {
      for (const a of arr) all.push(a.trim().toLowerCase());
    }
  }
  if (all.length === 0) return null;
  return new Set(all).size / all.length;
}

// ─── generation_log writer ───

interface GenerationLogEntry {
  user_id?: string;
  goal: string;
  domain?: string;
  language: string;
  lora_won: boolean;
  source_returned: 'lora' | 'llm-fallback' | 'haiku' | 'failed';
  lora_output: GeneratedMandala | null;
  lora_duration_ms: number | null;
  lora_error: string | null;
  llm_output: GeneratedMandala | null;
  llm_duration_ms: number | null;
  llm_error: string | null;
}

/**
 * Fire-and-forget log writer. Never throws — logging failure must not break
 * the user-facing race result. Captures derived quality metrics (validity,
 * sub_goal count, action uniqueness) from raw branch outputs.
 *
 * If the user_id FK is invalid (e.g. cross-environment JWT, deleted user),
 * the row is retried with user_id=null so we still preserve the analytics
 * payload. The originating user is then unlinked but the LoRA-vs-LLM
 * comparison data remains intact.
 */
async function logGenerationResult(entry: GenerationLogEntry): Promise<void> {
  const lora = entry.lora_output;
  const llm = entry.llm_output;
  const loraValid = lora ? validateMandala(lora).valid : null;
  const llmValid = llm ? validateMandala(llm).valid : null;
  const loraSubGoals = Array.isArray(lora?.sub_goals) ? lora.sub_goals.length : null;
  const loraActionsTotal = lora?.actions
    ? Object.values(lora.actions).reduce((s, a) => s + (Array.isArray(a) ? a.length : 0), 0)
    : null;
  const loraActionUniqueRate = computeActionUniqueRate(lora?.actions);

  const buildData = (userId: string | null) => ({
    user_id: userId,
    goal: entry.goal,
    domain: entry.domain ?? null,
    language: entry.language,
    lora_won: entry.lora_won,
    source_returned: entry.source_returned,
    lora_output: (lora ?? undefined) as Prisma.InputJsonValue | undefined,
    lora_duration_ms: entry.lora_duration_ms,
    lora_valid: loraValid,
    lora_sub_goals: loraSubGoals,
    lora_actions_total: loraActionsTotal,
    lora_action_unique_rate: loraActionUniqueRate,
    lora_error: entry.lora_error,
    llm_output: (llm ?? undefined) as Prisma.InputJsonValue | undefined,
    llm_duration_ms: entry.llm_duration_ms,
    llm_valid: llmValid,
    llm_error: entry.llm_error,
  });

  const db = getPrismaClient();

  try {
    await db.generation_log.create({ data: buildData(entry.user_id ?? null) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // FK violation on user_id (user not in this environment's auth.users) →
    // retry with null user_id so the analytics payload survives.
    if (entry.user_id && msg.includes('generation_log_user_id_fkey')) {
      try {
        await db.generation_log.create({ data: buildData(null) });
        logger.warn(`generation_log: user_id ${entry.user_id} not found, logged with user_id=null`);
        return;
      } catch (retryErr) {
        const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
        logger.warn(`generation_log: write failed (retry): ${retryMsg}`);
        return;
      }
    }
    logger.warn(`generation_log: write failed: ${msg}`);
  }
}

export async function generateMandalaRace(
  input: MandalaGenerateInput,
  options?: { userId?: string }
): Promise<RaceResult> {
  const start = Date.now();
  const userId = options?.userId;
  const lang = input.language ?? 'ko';

  // Full one-shot generation: structure + 64 actions (~20-25s)
  // Reverted from Phase 2 2-stage split due to fire-and-forget actions
  // reliability issues ("0/8" missing actions). Guarantees actions complete.
  let haikuDurationMs: number | null = null;
  let haikuError: string | null = null;

  let mandala: GeneratedMandala;
  try {
    mandala = await generateMandalaWithHaiku(input);
    haikuDurationMs = Date.now() - start;
  } catch (err) {
    haikuDurationMs = Date.now() - start;
    haikuError = err instanceof Error ? err.message : String(err);
    void logGenerationResult({
      user_id: userId,
      goal: input.goal,
      domain: input.domain,
      language: lang,
      lora_won: false,
      source_returned: 'failed',
      lora_output: null,
      lora_duration_ms: null,
      lora_error: null,
      llm_output: null,
      llm_duration_ms: haikuDurationMs,
      llm_error: haikuError,
    });
    throw err;
  }

  const dur = Date.now() - start;
  logger.info(`Mandala structure done: goal="${input.goal}" duration=${(dur / 1000).toFixed(1)}s`);

  // Background: LoRA — fire-and-forget for training data accumulation (v14)
  void generateMandala(input)
    .then((loraResult) => {
      void logGenerationResult({
        user_id: userId,
        goal: input.goal,
        domain: input.domain,
        language: lang,
        lora_won: false,
        source_returned: 'haiku',
        lora_output: loraResult,
        lora_duration_ms: Date.now() - start,
        lora_error: null,
        llm_output: mandala,
        llm_duration_ms: haikuDurationMs,
        llm_error: null,
      });
    })
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`LoRA background failed (non-fatal): ${msg}`);
    });

  return { mandala, source: 'haiku', duration_ms: dur };
}

// ─── Pre-warm ───
//
// Triggers Ollama to load the mandala-gen model into VRAM/RAM without
// generating a real response. Called fire-and-forget when the user enters
// the wizard goal step. By the time they click "Start", the model is already
// loaded — eliminating the ~45s cold-start that pushes total request time
// over the FE 180s budget.
//
// Sends `keep_alive: '24h'` so the loaded model stays resident.
// Returns true if the prewarm call succeeded (200), false otherwise. Never throws.

const PREWARM_TIMEOUT_MS = 60_000;

export async function prewarmMandalaModel(): Promise<boolean> {
  const url = config.mandalaGen.url;
  const model = config.mandalaGen.model;

  if (!url) {
    logger.warn('prewarmMandalaModel: MANDALA_GEN_URL not configured, skipping');
    return false;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PREWARM_TIMEOUT_MS);

  try {
    // num_predict: 1 → minimal generation, just enough to force model load.
    // Ollama treats this as a regular call so the model stays loaded for keep_alive.
    const response = await fetch(`${url}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt: 'ping',
        stream: false,
        keep_alive: '24h',
        options: { num_predict: 1, temperature: 0 },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      logger.warn(`prewarmMandalaModel: HTTP ${response.status}`);
      return false;
    }

    logger.info(`prewarmMandalaModel: model "${model}" warmed (keep_alive=24h)`);
    return true;
  } catch (err) {
    clearTimeout(timeout);
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`prewarmMandalaModel: failed: ${msg}`);
    return false;
  }
}
