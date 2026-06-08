/**
 * A-stage card relevance — CP498 PR3a.
 *
 * Computes a Haiku relevance score (0-100) of a card vs its mandala center
 * goal, from CARD-PROVIDED metadata (title/description) — caller passes the
 * text. This module is deliberately:
 *
 *   - PURE / side-effect-free: NO Prisma, NO DB write. The caller (PR3b worker)
 *     decides where to persist (user_local_cards.relevance_pct — user-scoped).
 *     It NEVER touches video_rich_summaries (the video-keyed column that leaks
 *     across users).
 *   - youtube_videos-INDEPENDENT: title/description come from the argument, not
 *     a youtube_videos lookup (placed cards are often absent from that table).
 *   - transcript-OPTIONAL: transcript defaults to '' → buildV2QuickPrompt falls
 *     back to title+description (CP498 premise: backfill works caption-free; a
 *     transcript only raises quality when present).
 *   - quick-only: a single Haiku call. The Sonnet full path is never invoked.
 *
 * Reuses the quick-path prompt + validator so the scoring instruction is a
 * single source of truth with the Heart path.
 */

import { OpenRouterGenerationProvider } from '@/modules/llm/openrouter';
import {
  buildV2QuickPrompt,
  validateV2Quick,
  V2QuickValidationError,
} from '@/modules/skills/rich-summary-v2-quick-prompt';

const HAIKU_MODEL = 'anthropic/claude-haiku-4.5';
const MAX_TOKENS = 800;
const TEMPERATURE = 0.2;

const HANGUL_RANGE = /[가-힣]/g;
const LATIN_RANGE = /[A-Za-z]/g;

/** Best-effort ko/en hint from the card title (default ko). */
function detectLanguage(title: string): 'ko' | 'en' {
  const stripped = title.replace(/\s+/g, '');
  if (stripped.length === 0) return 'ko';
  const hangul = (stripped.match(HANGUL_RANGE) ?? []).length / stripped.length;
  const latin = (stripped.match(LATIN_RANGE) ?? []).length / stripped.length;
  if (hangul >= 0.2) return 'ko';
  if (latin >= 0.5 && hangul < 0.05) return 'en';
  return 'ko';
}

export interface CardRelevanceInput {
  /** Card title (required — the minimal signal). */
  title: string;
  /** Card description / metadata_description (optional). */
  description?: string;
  /** The card's mandala centerGoal. Empty ⇒ model returns 0 per the prompt. */
  centerGoal: string;
  /** Optional transcript; '' ⇒ prompt uses title+description fallback. */
  transcript?: string;
}

export type CardRelevanceResult =
  | { ok: true; relevancePct: number }
  | { ok: false; reason: string };

/** Compute a 0-100 relevance score. No persistence — caller writes the result. */
export async function computeCardRelevance(
  input: CardRelevanceInput
): Promise<CardRelevanceResult> {
  if (!input.title || input.title.trim().length === 0) {
    return { ok: false, reason: 'no_title' };
  }

  const language = detectLanguage(input.title);
  const prompt = buildV2QuickPrompt({
    title: input.title,
    description: input.description ?? '',
    channel: '',
    language,
    transcript: input.transcript ?? '',
    mandalaCenterGoal: input.centerGoal,
  });

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

  // Haiku sometimes wraps JSON in a ```json fence even when told not to — strip
  // it before parsing (same handling as the quick generator).
  const stripped = raw
    .trim()
    .replace(/^\s*```(?:json)?\s*\n?/i, '')
    .replace(/\n?\s*```\s*$/i, '')
    .trim();

  let json: unknown;
  try {
    json = JSON.parse(stripped);
  } catch (err) {
    return { ok: false, reason: `json_parse: ${err instanceof Error ? err.message : String(err)}` };
  }

  try {
    const parsed = validateV2Quick(json);
    return { ok: true, relevancePct: parsed.analysis.mandala_fit.mandala_relevance_pct };
  } catch (err) {
    const reason =
      err instanceof V2QuickValidationError
        ? `validation: ${err.path}: ${err.message}`
        : `validation_threw: ${err instanceof Error ? err.message : String(err)}`;
    return { ok: false, reason };
  }
}
