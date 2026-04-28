/**
 * Rich Summary reader — template_version branch (CP437).
 *
 * Consumers (UI, KG bridge, future RAG) call `readRichSummary(row)` and get
 * a normalized `NormalizedRichSummary` regardless of whether the row is v1
 * (`structured` jsonb) or v2 (layered `core`/`analysis`/`lora` columns).
 *
 * The v1 → normalized adapter is best-effort: it maps the legacy fields
 * (`core_argument`, `actionables`, `mandala_fit`, `tl_dr_*`) to the v2 shape
 * where mappable, and leaves layered-only fields (e.g. `core.target_audience`,
 * `core.domain` when the legacy row predates the SSOT) as `null`.
 *
 * Once Track A regeneration is 100% complete, callers can remove the v1
 * branch and delete the legacy `structured` column — see
 * `docs/design/rich-summary-v2-validation-filter.md` §4.3.
 */

import type {
  RichSummaryCore,
  RichSummaryAnalysis,
  RichSummaryLora,
  ContentType,
  DepthLevel,
} from './rich-summary-v2-prompt';
import { isDomainSlug, type DomainSlug } from '@/config/domains';

export type TemplateVersion = 'v1' | 'v2';

/**
 * Subset of `video_rich_summaries` columns the reader cares about. Kept as
 * an interface (not Prisma model) so unit tests can hand-craft fixtures
 * without DB context.
 */
export interface RichSummaryRow {
  video_id: string;
  template_version: string | null;
  one_liner: string | null;
  structured: unknown; // v1
  core: unknown; // v2
  analysis: unknown; // v2
  segments: unknown; // v2 (currently always null per spec §3-3)
  translations: unknown; // v2 (Phase 2)
  lora: unknown; // v2
  completeness: number | null;
  quality_score: number | null;
  quality_flag: string | null;
  source_language: string | null;
  model: string | null;
}

export interface NormalizedRichSummary {
  videoId: string;
  templateVersion: TemplateVersion;
  sourceLanguage: 'ko' | 'en' | null;
  oneLiner: string;
  core: RichSummaryCore | null;
  analysis: RichSummaryAnalysis | null;
  lora: RichSummaryLora | null;
  qualityFlag: string | null;
  /**
   * 0-1 score. v2 → completeness column directly. v1 → quality_score
   * (different scale historically but used as the legacy proxy until
   * Track A regenerates).
   */
  score: number;
  model: string | null;
}

/**
 * Read a rich-summary row and return the normalized layered shape.
 *
 * v2 path: returns the columns as-is (after a light type-narrowing pass).
 * v1 path: derives a partial layered shape from `structured` jsonb. Domain
 * is inferred from `mandala_fit.suggested_topics` only when the strings
 * exactly match a domain label/slug — otherwise null.
 */
export function readRichSummary(row: RichSummaryRow): NormalizedRichSummary {
  const templateVersion: TemplateVersion = row.template_version === 'v2' ? 'v2' : 'v1';
  const sourceLanguage =
    row.source_language === 'ko' || row.source_language === 'en' ? row.source_language : null;
  const oneLiner = row.one_liner ?? '';

  if (templateVersion === 'v2') {
    return {
      videoId: row.video_id,
      templateVersion,
      sourceLanguage,
      oneLiner,
      core: (row.core ?? null) as RichSummaryCore | null,
      analysis: (row.analysis ?? null) as RichSummaryAnalysis | null,
      lora: (row.lora ?? null) as RichSummaryLora | null,
      qualityFlag: row.quality_flag,
      score: row.completeness ?? 0,
      model: row.model,
    };
  }

  // v1 → adapt
  const v1 = (row.structured ?? null) as Record<string, unknown> | null;
  const adapted = adaptV1ToLayered(v1, oneLiner);
  return {
    videoId: row.video_id,
    templateVersion,
    sourceLanguage,
    oneLiner,
    core: adapted.core,
    analysis: adapted.analysis,
    lora: null, // v1 had no LoRA path — never populated
    qualityFlag: row.quality_flag,
    score: row.quality_score ?? 0,
    model: row.model,
  };
}

interface AdaptedLayered {
  core: RichSummaryCore | null;
  analysis: RichSummaryAnalysis | null;
}

/**
 * Best-effort v1 → layered adapter. Returns `null` for fields the legacy
 * shape did not capture (e.g. `target_audience`, `key_concepts`). Callers
 * should NOT treat this as a v2-quality summary — it exists only so the
 * UI can render a passable view until Track A regeneration completes.
 */
export function adaptV1ToLayered(
  v1: Record<string, unknown> | null,
  oneLinerFallback: string
): AdaptedLayered {
  if (!v1) return { core: null, analysis: null };

  const oneLiner = pickString(v1['core_argument']) ?? oneLinerFallback ?? '';

  const domainGuess = guessDomainFromV1(v1);
  const contentType = pickEnum<ContentType>(v1['content_type'], [
    'tutorial',
    'lecture',
    'vlog',
    'interview',
    'documentary',
    'review',
  ]);
  const depthLevel = pickEnum<DepthLevel>(v1['depth_level'], [
    'beginner',
    'intermediate',
    'advanced',
  ]);

  const core: RichSummaryCore | null =
    domainGuess && contentType && depthLevel
      ? {
          one_liner: oneLiner.slice(0, 80),
          domain: domainGuess,
          depth_level: depthLevel,
          content_type: contentType,
          target_audience: '',
        }
      : null;

  const fitRaw = v1['mandala_fit'];
  const fit =
    fitRaw && typeof fitRaw === 'object'
      ? (fitRaw as Record<string, unknown>)
      : ({} as Record<string, unknown>);
  const suggested = arrayOfStrings(fit['suggested_topics'] ?? fit['suggested_goals']) ?? [];
  const rationale = pickString(fit['relevance_rationale']) ?? '';

  const actionables = arrayOfStrings(v1['actionables']) ?? [];
  const biasArr = arrayOfStrings(v1['bias_signals']);

  const analysis: RichSummaryAnalysis = {
    core_argument: pickString(v1['core_argument']) ?? oneLiner,
    key_concepts: [], // v1 had no key_concepts
    actionables,
    mandala_fit: {
      suggested_goals: suggested,
      relevance_rationale: rationale,
    },
    bias_signals: {
      has_ad: biasArr ? biasArr.some((s) => /\bad\b|광고|sponsor|협찬/i.test(s)) : false,
      is_sponsored: biasArr ? biasArr.some((s) => /sponsor|협찬/i.test(s)) : false,
      subjectivity_level: 'low',
      notes: biasArr ? biasArr.join('; ') : '',
    },
    prerequisites: arrayOfStrings(v1['prerequisites'])?.join(', ') ?? '',
  };

  return { core, analysis };
}

// ============================================================================
// Helpers
// ============================================================================

function pickString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function pickEnum<T extends string>(v: unknown, allowed: T[]): T | null {
  if (typeof v !== 'string') return null;
  return allowed.includes(v as T) ? (v as T) : null;
}

function arrayOfStrings(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  return v.filter((x): x is string => typeof x === 'string' && x.length > 0);
}

function guessDomainFromV1(v1: Record<string, unknown>): DomainSlug | null {
  // Look at suggested_topics first — those sometimes carry domain words.
  const fitRaw = v1['mandala_fit'];
  const fit = fitRaw && typeof fitRaw === 'object' ? (fitRaw as Record<string, unknown>) : null;
  const topics = fit ? arrayOfStrings(fit['suggested_topics'] ?? fit['suggested_goals']) : null;
  if (topics) {
    for (const t of topics) {
      if (isDomainSlug(t)) return t;
    }
  }
  return null;
}
