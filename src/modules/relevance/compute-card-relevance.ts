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
// CP499+ lang 정합 (#902): the prompt language follows the MANDALA language
// (caller passes it). The previous LOCAL ratio-based detector (a 3rd variant of
// detectLanguage in the codebase) is removed — fallback when the caller has no
// mandala language is the single utils detector (Hangul-presence rule).
import { detectLanguage } from '@/utils/detect-language';

const HAIKU_MODEL = 'anthropic/claude-haiku-4.5';
const MAX_TOKENS = 800;
const TEMPERATURE = 0.2;

export interface CardRelevanceInput {
  /** Card title (required — the minimal signal). */
  title: string;
  /** Card description / metadata_description (optional). */
  description?: string;
  /** The card's mandala centerGoal. Empty ⇒ model returns 0 per the prompt. */
  centerGoal: string;
  /**
   * CP499 — the cell (sub-goal) this card is placed into. When present, the goal
   * text passed to the scorer is a 2-label block (center + cell + criterion) so
   * the score reflects cell-fit AND center contribution. When absent, the goal
   * is `centerGoal` verbatim — byte-identical to the pre-CP499 string, so the
   * SHARED v2 Heart path (rich-summary-v2-quick-generator, which never passes
   * cellGoal) is unchanged. SSOT param, routed from wizard/manual/backfill.
   */
  cellGoal?: string;
  /** Optional transcript; '' ⇒ prompt uses title+description fallback. */
  transcript?: string;
  /**
   * CP499+ lang 정합 (#902) — the MANDALA's language (judging/display language).
   * Absent ⇒ utils detectLanguage(title) fallback (Hangul-presence rule). The
   * card-title language is a content attribute, not the judging language.
   */
  language?: 'ko' | 'en';
  /**
   * CP499+ rubric mode (RELEVANCE_RUBRIC_ENABLED — caller reads config; this
   * module stays config-free). PURE 3-axis LLM scoring + code composition.
   * Absent/false ⇒ legacy single-axis behavior, byte-identical prompt.
   * CP500+ 축 분리 (James 2026-06-12): freshness is NOT a score axis —
   * relevance ≠ recency. The volatile-only 70/30 recency QUOTA lives at the
   * PLACEMENT layer (separate follow-up; uses user_mandalas.volatility there).
   */
  rubric?: boolean;
}

/** Rubric-mode raw axes, returned for logging (relevance_detail = log-only for now). */
export interface CardRelevanceDetail {
  cellFitPct: number | null;
  goalContributionPct: number;
  actionabilityPct: number;
}

export type CardRelevanceResult =
  | { ok: true; relevancePct: number; detail?: CardRelevanceDetail }
  | { ok: false; reason: string };

/** Compute a 0-100 relevance score. No persistence — caller writes the result. */
export async function computeCardRelevance(
  input: CardRelevanceInput
): Promise<CardRelevanceResult> {
  if (!input.title || input.title.trim().length === 0) {
    return { ok: false, reason: 'no_title' };
  }

  // CP499+ lang 정합 (#902): mandala language wins; title detection is fallback.
  const language = input.language ?? detectLanguage(input.title);
  const hasCell = Boolean(input.cellGoal && input.cellGoal.trim().length > 0);
  // CP499 — cell-aware goal (legacy single-axis path). cellGoal present ⇒
  // labeled 2-line block + criterion. Absent ⇒ `centerGoal` verbatim, i.e. the
  // exact same string passed to the SHARED buildV2QuickPrompt before CP499, so
  // the v2 Heart path (no cellGoal) is byte-for-byte unchanged.
  // Rubric mode passes centerGoal + cellGoal SEPARATELY (the prompt has a
  // dedicated CELL GOAL line and per-axis rules).
  const goal =
    !input.rubric && hasCell
      ? `중심 목표: ${input.centerGoal}\n` +
        `이 카드가 배치될 셀: ${input.cellGoal}\n` +
        `→ 이 영상이 셀에 적합하면서 중심 목표에 기여하는 정도로 평가`
      : input.centerGoal;
  const prompt = buildV2QuickPrompt({
    title: input.title,
    description: input.description ?? '',
    channel: '',
    language,
    transcript: input.transcript ?? '',
    mandalaCenterGoal: goal,
    rubric: input.rubric,
    cellGoal: input.rubric ? input.cellGoal : undefined,
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
    const parsed = validateV2Quick(json, { rubric: input.rubric });
    const fit = parsed.analysis.mandala_fit;
    if (input.rubric && fit.rubric) {
      // Composite came from composeRubricScore (in the validator) — PURE
      // 3-axis, no freshness term (CP500+ 축 분리: relevance ≠ recency; the
      // volatile-only recency quota is a placement-layer follow-up).
      return {
        ok: true,
        relevancePct: fit.mandala_relevance_pct,
        detail: {
          cellFitPct: fit.rubric.cell_fit_pct,
          goalContributionPct: fit.rubric.goal_contribution_pct,
          actionabilityPct: fit.rubric.actionability_pct,
        },
      };
    }
    return { ok: true, relevancePct: fit.mandala_relevance_pct };
  } catch (err) {
    const reason =
      err instanceof V2QuickValidationError
        ? `validation: ${err.path}: ${err.message}`
        : `validation_threw: ${err instanceof Error ? err.message : String(err)}`;
    return { ok: false, reason };
  }
}
