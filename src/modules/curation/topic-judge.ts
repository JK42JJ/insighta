/**
 * Topic judging for curation candidates (2026-07-27).
 *
 * Two axes, one call:
 *   safe      — may this be shown at all on a learning product
 *   learnable — is a weekly study curation a sensible thing to build from it
 *
 * The second axis is the reason this is an LLM and not a word list. Measured on
 * the live top-20 of trend_signals, roughly a third were plausible study
 * subjects; the rest were people, places, song titles, a church name, a web
 * novel. None of those are harmful and no blocklist can recognise them. Harmful
 * terms were 0.08% of the table — yet they ranked first, because `rising` is raw
 * popularity. Judging solves the large problem and the small one together.
 *
 * Cost is bounded by design: judging happens when the collector runs (twice a
 * day, server cron), the verdict is persisted, and serving reads a column. A
 * user re-rolling proposals a hundred times issues zero LLM calls.
 *
 * Reuses the model resolution the collector already has — Haiku via OpenRouter,
 * swappable from admin through system_settings.
 */

import { logger } from '@/utils/logger';
import { config } from '@/config/index';
import { getSetting, SETTING_KEYS } from '@/modules/system-settings';
import { checkTopicSafety } from '@/modules/moderation/topic-safety';

const log = logger.child({ module: 'curation/topic-judge' });

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
/** Same default as the collector's keyword extraction. */
const DEFAULT_MODEL = 'anthropic/claude-haiku-4.5';
const REQUEST_TIMEOUT_MS = 60_000;
/** Keywords per call. Average keyword is ~12 chars, so this stays a small prompt. */
export const JUDGE_BATCH_SIZE = 100;

export type TopicVerdict = {
  keyword: string;
  safe: boolean;
  learnable: boolean;
  /** Short reason, only meaningful when something was rejected. */
  why: string;
};

const SYSTEM_PROMPT = `You screen candidate topics for a learning and knowledge product.
Users subscribe to a topic and receive a weekly set of educational videos about it.

For each keyword decide two independent things:

"safe": false when the keyword is sexual or suggestive, promotes gambling or
speculation as entertainment, solicits investment (stock picks, guaranteed
returns), instructs illegal or self-harming activity, or promotes hatred toward
a group. Reporting, documentary, prevention and first-hand accounts of these
subjects are SAFE — naming a social problem is not promoting it.

"learnable": false when no weekly educational series could reasonably be built
from it. Personal names, place names, song or film titles, individual channel or
organisation names, brand names alone, fandom or web-novel chatter, and
fragments that are not a subject are NOT learnable. Skills, academic and
professional fields, exams, technologies, crafts, health practices, and current
affairs framed as a subject ARE learnable.

Answer with JSON only, no prose, no markdown fence:
{"r":[{"i":0,"s":true,"l":true,"w":""},{"i":1,"s":false,"l":false,"w":"sexual"}]}

"i" is the index from the input list, "s" is safe, "l" is learnable, "w" is a
short reason in English (empty when both are true). Return one entry per input.`;

function buildUserPrompt(keywords: string[]): string {
  return keywords.map((k, i) => `${i}. ${k}`).join('\n');
}

/** Same resolution the collector's keyword extraction uses, so one admin
 *  setting swaps the model for both. */
async function resolveModel(): Promise<string> {
  try {
    const v = await getSetting<string>(SETTING_KEYS.TREND_EXTRACT_MODEL, DEFAULT_MODEL);
    return typeof v === 'string' && v.length > 0 ? v : DEFAULT_MODEL;
  } catch {
    return DEFAULT_MODEL;
  }
}

function stripFence(s: string): string {
  return s
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
}

/**
 * Judge one batch. Throws on transport/parse failure so the caller can decide
 * the policy — this module never silently passes an unjudged keyword.
 */
async function judgeBatch(
  keywords: string[],
  fetchImpl?: typeof fetch,
  apiKeyOverride?: string
): Promise<TopicVerdict[]> {
  // Injectable like llm-extract's opts.openRouterApiKey — CI has no key, so a
  // test must be able to supply one instead of always hitting the fail-closed path.
  const apiKey = apiKeyOverride ?? config.openrouter.apiKey ?? '';
  if (!apiKey) throw new Error('OpenRouter API key not configured');

  const model = await resolveModel();
  const fetchFn = fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetchFn(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(keywords) },
        ],
        temperature: 0,
        max_tokens: 4096,
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`OpenRouter HTTP ${res.status}`);

    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = json.choices?.[0]?.message?.content ?? '';
    const parsed = JSON.parse(stripFence(content)) as {
      r?: Array<{ i?: number; s?: boolean; l?: boolean; w?: string }>;
    };
    const rows = parsed.r ?? [];

    // Index back onto the input. A keyword the model skipped is NOT assumed good.
    const byIndex = new Map(
      rows.filter((r) => typeof r.i === 'number').map((r) => [r.i as number, r])
    );
    return keywords.map((keyword, i) => {
      const r = byIndex.get(i);
      if (!r) throw new Error(`judge returned no verdict for index ${i}`);
      return {
        keyword,
        safe: r.s !== false,
        learnable: r.l !== false,
        why: (r.w ?? '').slice(0, 120),
      };
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Judge every keyword, batched. On a batch failure the deterministic blocklist
 * decides safety and `learnable` is left undecided (null-ish → the caller stores
 * 'unknown' and serving excludes it), so an LLM outage can never turn into
 * harmful content being served.
 */
export async function judgeTopics(
  keywords: string[],
  fetchImpl?: typeof fetch,
  apiKeyOverride?: string
): Promise<Array<TopicVerdict & { degraded: boolean }>> {
  const out: Array<TopicVerdict & { degraded: boolean }> = [];
  for (let i = 0; i < keywords.length; i += JUDGE_BATCH_SIZE) {
    const chunk = keywords.slice(i, i + JUDGE_BATCH_SIZE);
    try {
      const verdicts = await judgeBatch(chunk, fetchImpl, apiKeyOverride);
      out.push(...verdicts.map((v) => ({ ...v, degraded: false })));
    } catch (err) {
      log.warn('topic judge batch failed — falling back to the deterministic floor', {
        from: i,
        size: chunk.length,
        error: err instanceof Error ? err.message : String(err),
      });
      out.push(
        ...chunk.map((keyword) => ({
          keyword,
          safe: checkTopicSafety(keyword).safe,
          learnable: false, // undecided, not "yes" — serving treats it as not ready
          why: 'judge unavailable',
          degraded: true,
        }))
      );
    }
  }
  return out;
}
