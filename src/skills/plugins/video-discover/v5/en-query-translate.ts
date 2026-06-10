/**
 * EN query pass — translation step (CP499+, '영문 카드 포함' toggle).
 *
 * One LLM call translates the weak cells' Korean search queries into natural
 * English YouTube search queries. Chosen over prompt-doubling in the main
 * query-gen (design (B), James-approved): the hot path stays untouched and a
 * failure here silently drops ONLY the EN pass — the Korean results are never
 * affected (fail-open ⇒ null).
 *
 * Cost: 1 Haiku-class call per toggle-ON add-cards run that HAS weak cells
 * (~$0.002, ~1-2s) + 100 search.list units per searched cell (fire is
 * unconditional on the toggle — James re-correction; assignment priority
 * for empty/low cells lives in binByCells, not here).
 */

import { logger } from '@/utils/logger';
import { OpenRouterGenerationProvider } from '@/modules/llm/openrouter';
import { SEARCH_QUERY_MODEL, SEARCH_QUERY_TEMPERATURE } from '@/prompts/search-query-generator';

const log = logger.child({ module: 'v5/en-query-translate' });

const TRANSLATE_MAX_TOKENS = 512;

export interface EnTranslateTarget {
  cellIndex: number;
  query: string;
}

export type GenerateImpl = (
  prompt: string,
  opts?: { temperature?: number; maxTokens?: number; format?: 'json' }
) => Promise<string>;

export function buildEnTranslatePrompt(targets: EnTranslateTarget[]): string {
  const lines = targets.map((t) => `"${t.cellIndex}": "${t.query.replace(/"/g, "'")}"`);
  return [
    'Translate each Korean YouTube search query into a natural English YouTube',
    'search query an English-speaking learner would actually type. Keep proper',
    'nouns / tool names as-is. Return ONLY a JSON object with the SAME keys:',
    `{${lines.join(', ')}}`,
  ].join('\n');
}

/** Strict parse: same keys back, non-empty string values. Anything else → null. */
export function parseEnTranslateResponse(
  raw: string,
  targets: EnTranslateTarget[]
): Map<number, string> | null {
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const out = new Map<number, string>();
    for (const t of targets) {
      const v = obj[String(t.cellIndex)];
      if (typeof v !== 'string' || v.trim().length === 0) return null;
      out.set(t.cellIndex, v.trim());
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Translate weak-cell queries to English. Fail-open: ANY failure (no key,
 * LLM error, parse mismatch) returns null and the caller skips the EN pass.
 */
export async function translateQueriesToEn(
  targets: EnTranslateTarget[],
  opts: { apiKey?: string; generateImpl?: GenerateImpl } = {}
): Promise<Map<number, string> | null> {
  if (targets.length === 0) return null;
  if (!opts.apiKey && !opts.generateImpl) return null;

  const generate =
    opts.generateImpl ??
    ((p: string, o?: { temperature?: number; maxTokens?: number; format?: 'json' }) =>
      new OpenRouterGenerationProvider(SEARCH_QUERY_MODEL).generate(p, o));

  try {
    const raw = await generate(buildEnTranslatePrompt(targets), {
      temperature: SEARCH_QUERY_TEMPERATURE,
      maxTokens: TRANSLATE_MAX_TOKENS,
      format: 'json',
    });
    const parsed = parseEnTranslateResponse(raw, targets);
    if (!parsed) log.warn('en-query-translate: parse failed — EN pass skipped (fail-open)');
    return parsed;
  } catch (err) {
    log.warn(
      `en-query-translate: LLM call failed — EN pass skipped (fail-open): ${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }
}
