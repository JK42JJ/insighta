/**
 * v5 per-cell LLM query generation (CP492).
 *
 * Rule-based concat (buildRuleBasedQueriesSync) collapses a cell label into a
 * 1-2 bare-noun tail appended to the full center goal, producing broad/garbage
 * queries ("...학습할 수", 9-word) that YouTube can't match → sparse → high-view
 * global backfill (Chinese drama / generic self-help / EN-AR leak). This module
 * translates each cell label into ONE focused, searchable query via a single
 * OpenRouter Haiku call.
 *
 * Safety: rule-based is always computed first as the fallback floor. No API key,
 * parse failure, validation failure, or any thrown error → rule-based queries
 * (worst case == current behavior). Per-cell: a missing/invalid cell falls back
 * to that cell's rule query. Gated behind V5_QUERY_GEN=llm (default 'rule').
 */

import { z } from 'zod';
import { logger } from '@/utils/logger';
import { OpenRouterGenerationProvider } from '@/modules/llm/openrouter';
import {
  SEARCH_QUERY_MODEL,
  SEARCH_QUERY_TEMPERATURE,
  SEARCH_QUERY_MAX_TOKENS,
  buildPerCellSearchQueryPrompt,
} from '@/prompts/search-query-generator';
import {
  buildRuleBasedQueriesSync,
  type SearchQuery,
  type KeywordBuilderInput,
} from '../v2/keyword-builder';

const log = logger.child({ module: 'video-discover/v5/llm-query-gen' });

/** A query longer than this is sentence-like → reject (the failure mode we fix). */
const MAX_LLM_QUERY_CHARS = 60;

export interface LLMQueryGenOpts {
  openRouterApiKey?: string;
  maxQueries?: number;
  /** Test injection — bypasses OpenRouter so unit tests never hit the network. */
  generateImpl?: (
    prompt: string,
    options?: { temperature?: number; maxTokens?: number; format?: 'json' }
  ) => Promise<string>;
}

/**
 * Parse + validate the LLM JSON object `{ "0": "q", ... }`. Tolerates code
 * fences and surrounding prose. Returns a cellIndex→query map of trimmed,
 * non-empty, non-sentence-length entries, or null when nothing usable parses.
 */
export function parsePerCellResponse(raw: string, cellCount: number): Map<number, string> | null {
  let text = (raw ?? '').trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence?.[1]) text = fence[1].trim();
  const brace = text.match(/\{[\s\S]*\}/);
  if (brace) text = brace[0];

  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = z.record(z.string()).safeParse(obj);
  if (!parsed.success) return null;

  const out = new Map<number, string>();
  for (const [k, v] of Object.entries(parsed.data)) {
    const idx = Number(k);
    if (!Number.isInteger(idx) || idx < 0 || idx >= cellCount) continue;
    const q = v.trim();
    if (q.length === 0 || q.length > MAX_LLM_QUERY_CHARS) continue;
    out.set(idx, q);
  }
  return out.size > 0 ? out : null;
}

/**
 * Generate one searchable query per cell via a single LLM call, with per-cell
 * rule fallback. Never throws. Returns rule-based queries on any failure.
 */
export async function buildLLMQueriesPerCell(
  input: KeywordBuilderInput,
  opts: LLMQueryGenOpts = {}
): Promise<SearchQuery[]> {
  const center = input.centerGoal.trim();
  if (!center) return [];

  // Fallback floor — always available, never throws.
  const ruleQueries = buildRuleBasedQueriesSync(input, opts.maxQueries);
  const subLabels = input.subGoals.map((s) => s.trim()).filter(Boolean);

  // No key / no labels → current rule-based behavior (flag-off-equivalent).
  if (!opts.openRouterApiKey || subLabels.length === 0) return ruleQueries;

  // Rule query indexed by cell, for gap-filling cells the LLM missed.
  const ruleByCell = new Map<number, SearchQuery>();
  for (const q of ruleQueries) {
    if (typeof q.cellIndex === 'number') ruleByCell.set(q.cellIndex, q);
  }

  const t0 = Date.now();
  try {
    const prompt = buildPerCellSearchQueryPrompt({
      centerGoal: center,
      subLabels,
      language: input.language,
      focusTags: input.focusTags,
    });
    const generate =
      opts.generateImpl ??
      ((p: string, o?: { temperature?: number; maxTokens?: number; format?: 'json' }) =>
        new OpenRouterGenerationProvider(SEARCH_QUERY_MODEL).generate(p, o));

    const raw = await generate(prompt, {
      temperature: SEARCH_QUERY_TEMPERATURE,
      maxTokens: SEARCH_QUERY_MAX_TOKENS,
      format: 'json',
    });

    const parsed = parsePerCellResponse(raw, subLabels.length);
    if (!parsed) {
      log.warn('v5 llm-query-gen: parse/validate failed — rule-based fallback');
      return ruleQueries;
    }

    // One query per cell: LLM where valid, rule for the gaps.
    const out: SearchQuery[] = [];
    let llmCells = 0;
    for (let i = 0; i < subLabels.length; i++) {
      const llmQ = parsed.get(i);
      if (llmQ) {
        out.push({ query: llmQ, source: 'llm', cellIndex: i });
        llmCells++;
      } else {
        const r = ruleByCell.get(i);
        if (r) out.push(r);
      }
    }
    log.info(
      `v5 llm-query-gen: ${llmCells}/${subLabels.length} cells from LLM (${Date.now() - t0}ms)`
    );
    return out.length > 0 ? out : ruleQueries;
  } catch (err) {
    log.warn(
      `v5 llm-query-gen failed (${err instanceof Error ? err.message : String(err)}) — rule-based fallback`
    );
    return ruleQueries;
  }
}
