/**
 * Rich Summary v2 — layered prompt + types + completeness scorer (CP437).
 *
 * Distinct from the existing `RICH_SUMMARY_V2_PROMPT` (which targets the
 * single `structured` jsonb column with KG-bridge friendly flat shape).
 * This module produces the LAYERED v2 schema documented in
 * `docs/design/rich-summary-v2-validation-filter.md` — written into the
 * separate `core` / `analysis` / `lora` jsonb columns.
 *
 * Hard Rule note: this module DEFINES the prompt and validation. The actual
 * LLM call lives in `rich-summary-v2-generator.ts` and is invoked from a
 * prod-runtime cron (see `scheduler/rich-summary-v2-cron.ts`). No standalone
 * batch script ever calls these prompts.
 */

import { DOMAIN_SLUGS, type DomainSlug } from '@/config/domains';
import { loadRichSummaryConfig } from '@/config/rich-summary';

// ============================================================================
// Layered v2 schema types — match prisma columns
// ============================================================================

export type DepthLevel = 'beginner' | 'intermediate' | 'advanced';
export type ContentType = 'tutorial' | 'lecture' | 'vlog' | 'interview' | 'documentary' | 'review';
export type SubjectivityLevel = 'low' | 'medium' | 'high';

export interface RichSummaryCore {
  one_liner: string;
  domain: DomainSlug;
  depth_level: DepthLevel;
  content_type: ContentType;
  target_audience: string;
}

export interface KeyConcept {
  term: string;
  definition: string;
}

export interface BiasSignals {
  has_ad: boolean;
  is_sponsored: boolean;
  subjectivity_level: SubjectivityLevel;
  notes: string;
}

// CP474 — entities are now emitted by the same single-LLM-call (was
// previously only present in the legacy structured-jsonb v1 path). These
// feed the KG bridge: each entity becomes a topic/concept/person/tool/
// framework/organization node, and `atoms[].entity_refs` link insights
// back to these names. The 5-type vocabulary mirrors
// rich-summary-types.ts:18 RichSummaryEntity.
export type EntityType = 'concept' | 'person' | 'tool' | 'framework' | 'organization';

export interface RichSummaryEntity {
  name: string;
  type: EntityType;
}

export interface MandalaFit {
  suggested_goals: string[];
  relevance_rationale: string;
  /**
   * CP462+ Issue #649 — 0-100 integer score (single value) capturing how
   * well this video fits the user's mandala center_goal that triggered the
   * generation. NULL when generation predates the column (legacy rows
   * lazy-regenerate on Heart click).
   *
   * Distinct from `segments[].relevance_pct` (intra-video chapter metric).
   */
  mandala_relevance_pct: number;
}

export interface RichSummaryAnalysis {
  core_argument: string;
  key_concepts: KeyConcept[];
  /**
   * CP474 — typed entities (concept / person / tool / framework /
   * organization). Source of truth for KG bridge nodes and the target
   * of `segments.atoms[].entity_refs`. Distinct from key_concepts:
   * key_concepts.term carries a definition; entities[].name is a bare
   * label with a type. The two arrays often overlap on `term ↔ name`
   * for 'concept' entries.
   */
  entities: RichSummaryEntity[];
  actionables: string[];
  mandala_fit: MandalaFit;
  bias_signals: BiasSignals;
  prerequisites: string;
}

export interface QAPair {
  level: 1 | 2 | 3;
  q: string;
  a: string;
  context: 'video' | 'mandala_cell' | 'mandala_mesh';
}

export interface RichSummaryLora {
  qa_pairs: QAPair[];
}

// CP474 — segments now emitted by the same single-LLM-call (was previously
// only populated via the Mac Mini v2-author cron + upsert-direct path).
// The shape mirrors validateV2Segments's allowed-key whitelist.
export interface RichSummarySectionKeyPoint {
  text: string;
  timestamp_sec?: number;
}
export interface RichSummarySection {
  idx?: number;
  from_sec: number;
  to_sec: number;
  title: string;
  summary?: string;
  relevance_pct: number;
  key_points?: RichSummarySectionKeyPoint[];
}
export interface RichSummaryAtom {
  idx?: number;
  type: string;
  text: string;
  timestamp_sec?: number;
  entity_refs?: string[];
}
export interface RichSummarySegments {
  sections?: RichSummarySection[];
  atoms?: RichSummaryAtom[];
}

export interface RichSummaryV2Layered {
  core: RichSummaryCore;
  analysis: RichSummaryAnalysis;
  lora: RichSummaryLora;
  /** CP474 — optional. Empty/undefined when the transcript was absent or
   *  the LLM declined to emit segments. */
  segments?: RichSummarySegments;
}

// ============================================================================
// Constants
// ============================================================================

export const ONE_LINER_MAX_LEN = 20;
export const PASS_THRESHOLD = 0.7;
export const MIN_KEY_CONCEPTS = 3;
export const MIN_ACTIONABLES = 3;
export const MIN_QA_PAIRS_L1 = 5;
// Segments hard gate — rejects description-only fallback (1 catch-all
// section, to_sec=0, <5 atoms). Mirrors the prompt's own minimums.
// CP475+ — hard minimums removed (user directive 2026-05-20: "원본이
// 짧은 경우, 처리가 이루어져야하는 것이 정상"). Short videos with
// transcript < 1000 chars often legitimately produce 1-2 sections /
// 2-3 atoms. Forcing a 3/5 minimum caused valid short videos to fail
// with quality_flag='low' even though their content was fully analysed.
// Kept as 1 so the validators below still reject completely-empty
// segments (description-only fallback).
export const MIN_SECTIONS = 1;
export const MIN_ATOMS = 1;

const VALID_CONTENT_TYPES: ReadonlySet<ContentType> = new Set([
  'tutorial',
  'lecture',
  'vlog',
  'interview',
  'documentary',
  'review',
]);
const VALID_DEPTH_LEVELS: ReadonlySet<DepthLevel> = new Set([
  'beginner',
  'intermediate',
  'advanced',
]);
const VALID_SUBJECTIVITY: ReadonlySet<SubjectivityLevel> = new Set(['low', 'medium', 'high']);
const VALID_DOMAIN_SET: ReadonlySet<string> = new Set(DOMAIN_SLUGS);
const VALID_ENTITY_TYPES: ReadonlySet<EntityType> = new Set([
  'concept',
  'person',
  'tool',
  'framework',
  'organization',
]);

// ============================================================================
// Prompt template
// ============================================================================

/**
 * The prompt asks for layered output keyed by `core`/`analysis`/`lora`.
 * Output language follows `source_language` ('ko' or 'en'). The model is
 * instructed to keep `core.domain` strictly within the 9 SSOT slugs so
 * downstream graph wiring (mandala_fit → goal nodes) is type-safe.
 */
export const RICH_SUMMARY_V2_LAYERED_PROMPT = `You are a learning content analyst. Analyze the YouTube video below and respond ONLY in valid JSON. Output language MUST be {language} (ko = Korean, en = English).

Video title: {title}
Video description: {description}
Channel: {channel}
Video duration: {video_duration_sec} seconds ({video_duration_human}) — the wall-clock length of the video. Section and atom timestamps MUST stay within this range.
Transcript (when available; empty otherwise): {transcript_block}
User mandala center goal (the learning objective the viewer is pursuing; empty when not provided): {mandala_center_goal}

Respond with this exact JSON structure (no extra keys, no comments):
{{
  "core": {{
    "one_liner": "{language_label}: 20 characters or less",
    "domain": "one of: tech | learning | health | business | finance | social | creative | lifestyle | mind",
    "depth_level": "beginner | intermediate | advanced",
    "content_type": "tutorial | lecture | vlog | interview | documentary | review",
    "target_audience": "1 sentence describing the target viewer"
  }},
  "analysis": {{
    "core_argument": "2-3 sentences capturing the central thesis",
    "key_concepts": [
      {{"term": "concept name", "definition": "short definition"}}
    ],
    "entities": [
      {{"name": "Entity label as it appears in the video", "type": "concept"}}
    ],
    "actionables": ["concrete action item the viewer can do today"],
    "mandala_fit": {{
      "suggested_goals": ["goal phrase 1", "goal phrase 2"],
      "relevance_rationale": "1 sentence explaining why this video fits those goals",
      "mandala_relevance_pct": 0
    }},
    "bias_signals": {{
      "has_ad": false,
      "is_sponsored": false,
      "subjectivity_level": "low | medium | high",
      "notes": "empty string if nothing notable"
    }},
    "prerequisites": "comma-separated list of required prior knowledge, or empty string"
  }},
  "lora": {{
    "qa_pairs": [
      {{"level": 1, "q": "video-only Q", "a": "answer derived from the video", "context": "video"}}
    ]
  }},
  "segments": {{
    "sections": [
      {{
        "idx": 0,
        "from_sec": 0,
        "to_sec": 102,
        "title": "Section title (≤ 30 chars, no quotes)",
        "summary": "What this section covers in 1 sentence",
        "relevance_pct": 65,
        "key_points": [
          {{"text": "Key point grounded in the section", "timestamp_sec": 45}}
        ]
      }}
    ],
    "atoms": [
      {{"idx": 0, "type": "fact", "text": "Standalone insight or claim", "timestamp_sec": 120, "entity_refs": ["Concept name"]}}
    ]
  }}
}}

Field rules:
- core.one_liner: ≤ 20 chars, no quotes, no trailing punctuation.
- core.domain: MUST be one of the 9 slugs above. No other values, no labels in Korean/English.
- analysis.key_concepts: 3-5 entries.
- analysis.entities: 3-10 entries. Each has a 'name' (bare label, no quotes) and a 'type' that MUST be one of: concept | person | tool | framework | organization. Use 'concept' for ideas/methods, 'person' for named individuals, 'tool' for software/products, 'framework' for named methodologies/processes, 'organization' for companies/institutions. When unsure, default to 'concept'. Entries should be distinct (no duplicate names). These are the KG bridge nodes — segments.atoms[].entity_refs should reference these names verbatim.
- analysis.actionables: 3-5 entries, each a single imperative sentence.
- analysis.mandala_fit.suggested_goals: 2-4 short phrases that align with the 9-domain SSOT taxonomy.
- analysis.mandala_fit.mandala_relevance_pct: integer 0-100 reflecting how well this video fits the user's mandala center goal above. Score 0 when the center goal is empty or genuinely unrelated; higher values mean stronger alignment. Be conservative — 90+ only when the video clearly addresses the exact goal.
- analysis.bias_signals.has_ad / is_sponsored: boolean. Only true when explicitly visible in the title/description.
- lora.qa_pairs: 5-7 entries, all level=1, all context="video". Each Q is something a learner would ask AFTER watching this video; A is grounded in the video content.
- prerequisites: empty string when none.
- segments.sections: dividing the video timeline. Section count adapts to video length — a 2-minute video may legitimately have 1-2 sections; a 20-minute video 6-8; a 40-60 minute lecture 10-15; longer talks more as needed. from_sec/to_sec integers in seconds, monotonically increasing, derived from transcript timestamps. **CRITICAL: sections MUST cover the ENTIRE video timeline — the last section's to_sec must be at or near the final transcript timestamp. Do NOT stop after the first 20-30 minutes of a longer video.** If the transcript provided spans the full video, produce sections that tile it end-to-end (no gaps after the last section). relevance_pct (integer 0-100) is the intra-video metric for THIS section vs the user's mandala center goal — distinct from analysis.mandala_fit.mandala_relevance_pct (which is the whole-video score). Each section has 1-3 key_points; timestamp_sec is optional and falls within the section's [from_sec, to_sec] window.
- segments.atoms: standalone insights spanning the FULL video timeline (not just the first quarter). Atom count adapts to content density — short videos may yield 2-3 atoms; 20-minute videos 8-15; longer/denser videos 15-30. type MUST be one of: fact | argument | tip | other. timestamp_sec is optional but, when provided, MUST be sorted ascending across the array AND the highest timestamp_sec should be at or near the final transcript timestamp (mirrors the "cover the full timeline" rule above). entity_refs is optional and links to analysis.entities[].name values (fallback: analysis.key_concepts[].term).

Output rules:
- Return JSON only — no markdown fences, no commentary, no chain-of-thought.
- Use {language} consistently across every string field (Korean if 'ko', English if 'en').
- When the Transcript block is non-empty, prefer transcript content over description/title for evidence in qa_pairs.a and analysis.core_argument. When empty, fall back to title + description.
- When the Transcript block is empty (= "(no transcript)"): segments.sections should be a single catch-all entry (from_sec: 0, to_sec: 0, relevance_pct: 50) and segments.atoms entries should omit timestamp_sec — the LLM cannot infer real timestamps without transcript evidence. Do NOT fabricate timestamps.
- When the Transcript block is non-empty, it is formatted as ONE LINE PER CAPTION segment prefixed with [mm:ss] (or [hh:mm:ss] past one hour) — for example: "[00:12] 안녕하세요" / "[01:05] 오늘 주제는". These prefixes are ground truth. Derive every section's from_sec/to_sec and every atom's timestamp_sec by READING the bracket prefixes directly; DO NOT estimate. The first section must start at 0 and the last section's to_sec must equal (or be within 5% of) the Video duration listed above. atoms.timestamp_sec MUST be monotonically ascending and the maximum value MUST not exceed (Video duration × 1.05).`;

// ============================================================================
// Prompt fill helper
// ============================================================================

export interface PromptInput {
  title: string;
  description: string;
  channel: string;
  language: 'ko' | 'en';
  /**
   * Optional transcript text. When provided, the LLM is instructed to
   * prefer transcript-derived evidence over description/title. The
   * transcript is truncated to TRANSCRIPT_MAX_CHARS to stay within
   * provider token limits.
   *
   * CP488+ Phase 1.5 — callers should pass the annotated form
   * (`[mm:ss] text\n…` produced by `formatAnnotatedTranscript`). The
   * legacy fullText form still works (the LLM falls back to estimating
   * timeline coverage) but produces the hallucination pattern Phase 3
   * dogfooding surfaced.
   */
  transcript?: string;
  /**
   * CP462+ Issue #649 — optional mandala center goal text. When provided,
   * the LLM uses it as the reference point for
   * `analysis.mandala_fit.mandala_relevance_pct` scoring. When empty, the
   * model is instructed to return 0 for that field.
   */
  mandalaCenterGoal?: string;
  /**
   * CP488+ Phase 1.5 — video wall-clock length in seconds (sourced from
   * `youtube_videos.duration_seconds`). When known, the prompt declares
   * it explicitly so the LLM can produce sections/atoms timestamps that
   * fit the actual timeline. When unknown (null/undefined), the
   * placeholder renders as "unknown" and the timeline-range validator
   * downstream is a no-op.
   */
  durationSeconds?: number | null;
}

function formatHumanDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (hh > 0) return `${hh}h${mm}m${ss}s`;
  return `${mm}m${ss}s`;
}

export function buildV2Prompt(input: PromptInput): string {
  const languageLabel = input.language === 'ko' ? 'Korean' : 'English';
  const { transcriptMaxChars } = loadRichSummaryConfig();
  const transcriptBlock =
    input.transcript && input.transcript.length > 0
      ? input.transcript.slice(0, transcriptMaxChars)
      : '(no transcript)';
  const centerGoalBlock =
    input.mandalaCenterGoal && input.mandalaCenterGoal.trim().length > 0
      ? input.mandalaCenterGoal.trim().slice(0, MANDALA_CENTER_GOAL_MAX_CHARS)
      : '(empty)';
  const durationSec =
    input.durationSeconds != null && Number.isFinite(input.durationSeconds)
      ? Math.max(0, Math.floor(input.durationSeconds))
      : null;
  const durationSecText = durationSec != null ? String(durationSec) : 'unknown';
  const durationHumanText = durationSec != null ? formatHumanDuration(durationSec) : 'unknown';
  return RICH_SUMMARY_V2_LAYERED_PROMPT.replace(/\{title\}/g, input.title.slice(0, 200))
    .replace(/\{description\}/g, input.description.slice(0, 800))
    .replace(/\{channel\}/g, input.channel.slice(0, 80))
    .replace(/\{transcript_block\}/g, transcriptBlock)
    .replace(/\{mandala_center_goal\}/g, centerGoalBlock)
    .replace(/\{video_duration_sec\}/g, durationSecText)
    .replace(/\{video_duration_human\}/g, durationHumanText)
    .replace(/\{language\}/g, input.language)
    .replace(/\{language_label\}/g, languageLabel);
}

/** Hard cap on mandala center goal string to keep prompt token use bounded. */
export const MANDALA_CENTER_GOAL_MAX_CHARS = 200;

// ============================================================================
// Validator (after JSON.parse) — narrow to RichSummaryV2Layered or throw
// ============================================================================

export class V2ValidationError extends Error {
  constructor(
    message: string,
    public readonly path: string
  ) {
    super(message);
    this.name = 'V2ValidationError';
  }
}

function requireString(v: unknown, path: string, maxLen?: number): string {
  if (typeof v !== 'string' || v.length === 0) {
    throw new V2ValidationError('expected non-empty string', path);
  }
  if (maxLen !== undefined && v.length > maxLen) {
    throw new V2ValidationError(`exceeds max length ${maxLen} (got ${v.length})`, path);
  }
  return v;
}

function requireArray<T>(v: unknown, path: string): T[] {
  if (!Array.isArray(v)) throw new V2ValidationError('expected array', path);
  return v as T[];
}

export function validateV2Layered(parsed: unknown): RichSummaryV2Layered {
  if (!parsed || typeof parsed !== 'object') {
    throw new V2ValidationError('root must be an object', '');
  }
  const obj = parsed as Record<string, unknown>;

  // core
  const coreRaw = obj['core'];
  if (!coreRaw || typeof coreRaw !== 'object') {
    throw new V2ValidationError('missing core object', 'core');
  }
  const c = coreRaw as Record<string, unknown>;
  const oneLiner = requireString(c['one_liner'], 'core.one_liner', ONE_LINER_MAX_LEN * 4); // accept long but flag in completeness
  const domain = requireString(c['domain'], 'core.domain');
  if (!VALID_DOMAIN_SET.has(domain)) {
    throw new V2ValidationError(`unknown domain '${domain}'`, 'core.domain');
  }
  const depthLevel = requireString(c['depth_level'], 'core.depth_level');
  if (!VALID_DEPTH_LEVELS.has(depthLevel as DepthLevel)) {
    throw new V2ValidationError(`unknown depth_level '${depthLevel}'`, 'core.depth_level');
  }
  const contentType = requireString(c['content_type'], 'core.content_type');
  if (!VALID_CONTENT_TYPES.has(contentType as ContentType)) {
    throw new V2ValidationError(`unknown content_type '${contentType}'`, 'core.content_type');
  }
  const targetAudience = requireString(c['target_audience'], 'core.target_audience');

  const core: RichSummaryCore = {
    one_liner: oneLiner,
    domain: domain as DomainSlug,
    depth_level: depthLevel as DepthLevel,
    content_type: contentType as ContentType,
    target_audience: targetAudience,
  };

  // analysis
  const analysisRaw = obj['analysis'];
  if (!analysisRaw || typeof analysisRaw !== 'object') {
    throw new V2ValidationError('missing analysis object', 'analysis');
  }
  const a = analysisRaw as Record<string, unknown>;
  const coreArgument = requireString(a['core_argument'], 'analysis.core_argument');
  const keyConceptsRaw = requireArray<unknown>(a['key_concepts'], 'analysis.key_concepts');
  const keyConcepts: KeyConcept[] = keyConceptsRaw.map((k, i) => {
    if (!k || typeof k !== 'object') {
      throw new V2ValidationError('key_concept must be object', `analysis.key_concepts[${i}]`);
    }
    const kk = k as Record<string, unknown>;
    return {
      term: requireString(kk['term'], `analysis.key_concepts[${i}].term`),
      definition: requireString(kk['definition'], `analysis.key_concepts[${i}].definition`),
    };
  });
  // CP474 — entities are optional on the wire so pre-CP474 prompt
  // responses (or LLMs that omit the field on retry) still validate.
  // When present, every entry is strictly type-checked.
  let entities: RichSummaryEntity[] = [];
  const entitiesRaw = a['entities'];
  if (Array.isArray(entitiesRaw)) {
    entities = entitiesRaw.map((e, i) => {
      if (!e || typeof e !== 'object') {
        throw new V2ValidationError('entity must be object', `analysis.entities[${i}]`);
      }
      const ee = e as Record<string, unknown>;
      const name = requireString(ee['name'], `analysis.entities[${i}].name`);
      const type = String(ee['type'] ?? '');
      if (!VALID_ENTITY_TYPES.has(type as EntityType)) {
        throw new V2ValidationError(
          `unknown entity type '${type}' (expected one of: ${[...VALID_ENTITY_TYPES].join(' | ')})`,
          `analysis.entities[${i}].type`
        );
      }
      return { name, type: type as EntityType };
    });
  }

  const actionablesRaw = requireArray<unknown>(a['actionables'], 'analysis.actionables');
  const actionables = actionablesRaw.map((s, i) => requireString(s, `analysis.actionables[${i}]`));

  const fitRaw = a['mandala_fit'];
  if (!fitRaw || typeof fitRaw !== 'object') {
    throw new V2ValidationError('missing mandala_fit', 'analysis.mandala_fit');
  }
  const f = fitRaw as Record<string, unknown>;
  const suggestedGoals = requireArray<unknown>(
    f['suggested_goals'],
    'analysis.mandala_fit.suggested_goals'
  ).map((s, i) => requireString(s, `analysis.mandala_fit.suggested_goals[${i}]`));
  const mandalaRelevancePctRaw = f['mandala_relevance_pct'];
  let mandalaRelevancePct: number;
  if (typeof mandalaRelevancePctRaw === 'number' && Number.isFinite(mandalaRelevancePctRaw)) {
    mandalaRelevancePct = Math.round(mandalaRelevancePctRaw);
  } else {
    throw new V2ValidationError(
      'expected integer 0-100',
      'analysis.mandala_fit.mandala_relevance_pct'
    );
  }
  if (mandalaRelevancePct < 0 || mandalaRelevancePct > 100) {
    throw new V2ValidationError(
      `out of range ${mandalaRelevancePct} (expected 0-100)`,
      'analysis.mandala_fit.mandala_relevance_pct'
    );
  }

  const mandalaFit: MandalaFit = {
    suggested_goals: suggestedGoals,
    relevance_rationale: requireString(
      f['relevance_rationale'],
      'analysis.mandala_fit.relevance_rationale'
    ),
    mandala_relevance_pct: mandalaRelevancePct,
  };

  const biasRaw = a['bias_signals'];
  if (!biasRaw || typeof biasRaw !== 'object') {
    throw new V2ValidationError('missing bias_signals', 'analysis.bias_signals');
  }
  const b = biasRaw as Record<string, unknown>;
  const subjectivity = String(b['subjectivity_level'] ?? 'low');
  const biasSignals: BiasSignals = {
    has_ad: Boolean(b['has_ad']),
    is_sponsored: Boolean(b['is_sponsored']),
    subjectivity_level: VALID_SUBJECTIVITY.has(subjectivity as SubjectivityLevel)
      ? (subjectivity as SubjectivityLevel)
      : 'low',
    notes: typeof b['notes'] === 'string' ? b['notes'] : '',
  };

  const prerequisites = typeof a['prerequisites'] === 'string' ? a['prerequisites'] : '';

  const analysis: RichSummaryAnalysis = {
    core_argument: coreArgument,
    key_concepts: keyConcepts,
    entities,
    actionables,
    mandala_fit: mandalaFit,
    bias_signals: biasSignals,
    prerequisites,
  };

  // lora
  const loraRaw = obj['lora'];
  if (!loraRaw || typeof loraRaw !== 'object') {
    throw new V2ValidationError('missing lora object', 'lora');
  }
  const l = loraRaw as Record<string, unknown>;
  const qaPairsRaw = requireArray<unknown>(l['qa_pairs'], 'lora.qa_pairs');
  const qa: QAPair[] = qaPairsRaw.map((q, i) => {
    if (!q || typeof q !== 'object') {
      throw new V2ValidationError('qa entry must be object', `lora.qa_pairs[${i}]`);
    }
    const qq = q as Record<string, unknown>;
    const level = qq['level'];
    if (level !== 1 && level !== 2 && level !== 3) {
      throw new V2ValidationError(
        `invalid level (expected 1/2/3) got ${String(level)}`,
        `lora.qa_pairs[${i}].level`
      );
    }
    const ctxRaw = String(qq['context'] ?? 'video');
    const ctx: QAPair['context'] =
      ctxRaw === 'mandala_cell' || ctxRaw === 'mandala_mesh' ? ctxRaw : 'video';
    return {
      level: level as 1 | 2 | 3,
      q: requireString(qq['q'], `lora.qa_pairs[${i}].q`),
      a: requireString(qq['a'], `lora.qa_pairs[${i}].a`),
      context: ctx,
    };
  });

  // CP474 — segments are optional. When present, run the strict key
  // whitelist (validateV2Segments) and pass the raw object through so
  // the generator can persist it to video_rich_summaries.segments as-is.
  let segments: RichSummarySegments | undefined;
  const segmentsRaw = obj['segments'];
  if (segmentsRaw !== undefined && segmentsRaw !== null) {
    validateV2Segments(segmentsRaw);
    segments = segmentsRaw as RichSummarySegments;
  }

  return { core, analysis, lora: { qa_pairs: qa }, segments };
}

// ============================================================================
// Segments validator — strict key whitelist (CP437 SSOT enforcement)
// ============================================================================

/**
 * Allowed keys for segments.sections[i] and segments.atoms[i].
 *
 * SSOT (insighta-ontology-data-architecture.md §5.4):
 *   sections — `idx`, `title`, `from_sec`, `to_sec`, `summary`, `key_points` (optional)
 *   atoms    — `idx`, `type`, `text`, `timestamp_sec`, `entity_refs` (optional)
 *
 * Common typos are explicitly listed in `FORBIDDEN_*` so the error message
 * tells the author exactly what to rename. The previous incident had bridge
 * silently storing 0/null when the JSON used `start_sec`/`end_sec`/`ts_sec`
 * because bridge accepted unknown keys without erroring.
 */
const ALLOWED_SECTION_KEYS = new Set([
  'idx',
  'title',
  'from_sec',
  'to_sec',
  'summary',
  'key_points',
  'relevance_pct',
]);
const ALLOWED_ATOM_KEYS = new Set(['idx', 'type', 'text', 'timestamp_sec', 'entity_refs']);
const FORBIDDEN_SECTION_RENAMES: Record<string, string> = {
  start_sec: 'from_sec',
  end_sec: 'to_sec',
};
const FORBIDDEN_ATOM_RENAMES: Record<string, string> = {
  ts_sec: 'timestamp_sec',
};

/**
 * Validate `segments` (optional, when present in `upsert-direct` body) —
 * throws `V2ValidationError` on first unknown key. Pass-through when null
 * or undefined (segments are optional).
 *
 * Catches the field-name mismatch class of bugs at the API boundary so
 * downstream bridge code never sees `start_sec`/`ts_sec` etc.
 */
export function validateV2Segments(segments: unknown): void {
  if (segments === null || segments === undefined) return;
  if (typeof segments !== 'object') {
    throw new V2ValidationError('segments must be an object', 'segments');
  }
  const seg = segments as Record<string, unknown>;

  if (seg['sections'] !== undefined) {
    if (!Array.isArray(seg['sections'])) {
      throw new V2ValidationError('segments.sections must be an array', 'segments.sections');
    }
    seg['sections'].forEach((s, i) => {
      if (!s || typeof s !== 'object') {
        throw new V2ValidationError(
          'segments.sections[i] must be an object',
          `segments.sections[${i}]`
        );
      }
      for (const key of Object.keys(s as Record<string, unknown>)) {
        if (FORBIDDEN_SECTION_RENAMES[key]) {
          throw new V2ValidationError(
            `forbidden key '${key}' — SSOT requires '${FORBIDDEN_SECTION_RENAMES[key]}' (insighta-ontology-data-architecture.md §5.4)`,
            `segments.sections[${i}].${key}`
          );
        }
        if (!ALLOWED_SECTION_KEYS.has(key)) {
          throw new V2ValidationError(
            `unknown key '${key}' (allowed: ${[...ALLOWED_SECTION_KEYS].join(', ')})`,
            `segments.sections[${i}].${key}`
          );
        }
      }
    });
  }

  if (seg['atoms'] !== undefined) {
    if (!Array.isArray(seg['atoms'])) {
      throw new V2ValidationError('segments.atoms must be an array', 'segments.atoms');
    }
    seg['atoms'].forEach((a, i) => {
      if (!a || typeof a !== 'object') {
        throw new V2ValidationError('segments.atoms[i] must be an object', `segments.atoms[${i}]`);
      }
      for (const key of Object.keys(a as Record<string, unknown>)) {
        if (FORBIDDEN_ATOM_RENAMES[key]) {
          throw new V2ValidationError(
            `forbidden key '${key}' — SSOT requires '${FORBIDDEN_ATOM_RENAMES[key]}' (insighta-ontology-data-architecture.md §5.4)`,
            `segments.atoms[${i}].${key}`
          );
        }
        if (!ALLOWED_ATOM_KEYS.has(key)) {
          throw new V2ValidationError(
            `unknown key '${key}' (allowed: ${[...ALLOWED_ATOM_KEYS].join(', ')})`,
            `segments.atoms[${i}].${key}`
          );
        }
      }
    });
  }
}

// ============================================================================
// Completeness scorer (10 × 0.1 weights, total 1.0; ≥ 0.7 = pass)
// ============================================================================

export interface CompletenessResult {
  score: number;
  passed: boolean;
  reasons: string[];
}

export function scoreCompleteness(s: RichSummaryV2Layered): CompletenessResult {
  let score = 0;
  const reasons: string[] = [];

  // core (5 × 0.1)
  if (s.core.one_liner.length > 0 && s.core.one_liner.length <= ONE_LINER_MAX_LEN) {
    score += 0.1;
  } else {
    reasons.push(
      `core.one_liner length ${s.core.one_liner.length} (expected 1-${ONE_LINER_MAX_LEN})`
    );
  }
  if (VALID_DOMAIN_SET.has(s.core.domain)) score += 0.1;
  else reasons.push(`core.domain '${s.core.domain}' not in 9 slugs`);
  if (VALID_DEPTH_LEVELS.has(s.core.depth_level)) score += 0.1;
  else reasons.push(`core.depth_level '${s.core.depth_level}' invalid`);
  if (VALID_CONTENT_TYPES.has(s.core.content_type)) score += 0.1;
  else reasons.push(`core.content_type '${s.core.content_type}' invalid`);
  if (s.core.target_audience.length > 0) score += 0.1;
  else reasons.push('core.target_audience empty');

  // analysis (4 × 0.1)
  if (s.analysis.core_argument.length >= 10) score += 0.1;
  else reasons.push(`analysis.core_argument too short (${s.analysis.core_argument.length} chars)`);
  if (s.analysis.key_concepts.length >= MIN_KEY_CONCEPTS) score += 0.1;
  else
    reasons.push(
      `analysis.key_concepts insufficient: ${s.analysis.key_concepts.length} (expected ${MIN_KEY_CONCEPTS}+)`
    );
  if (s.analysis.actionables.length >= MIN_ACTIONABLES) score += 0.1;
  else
    reasons.push(
      `analysis.actionables insufficient: ${s.analysis.actionables.length} (expected ${MIN_ACTIONABLES}+)`
    );
  if (
    s.analysis.mandala_fit.suggested_goals.length >= 2 &&
    s.analysis.mandala_fit.relevance_rationale.length > 0 &&
    Number.isInteger(s.analysis.mandala_fit.mandala_relevance_pct) &&
    s.analysis.mandala_fit.mandala_relevance_pct >= 0 &&
    s.analysis.mandala_fit.mandala_relevance_pct <= 100
  ) {
    score += 0.1;
  } else {
    reasons.push('analysis.mandala_fit incomplete');
  }

  // lora L1 (1 × 0.1)
  const l1Count = s.lora.qa_pairs.filter((q) => q.level === 1).length;
  if (l1Count >= MIN_QA_PAIRS_L1) score += 0.1;
  else reasons.push(`lora.qa_pairs L1 insufficient: ${l1Count} (expected ${MIN_QA_PAIRS_L1}+)`);

  // Segments gate — description-only fallback (all to_sec=0) still fails
  // outright. Section / atom counts are no longer hard-capped at 3 / 5;
  // the validators above accept 1+, since short videos legitimately
  // produce 1-2 sections / 2-3 atoms (user directive 2026-05-20).
  const sectionCount = s.segments?.sections?.length ?? 0;
  const atomCount = s.segments?.atoms?.length ?? 0;
  const sectionHasRealRange = (s.segments?.sections ?? []).some((sec) => sec.to_sec > 0);
  const segmentsValid =
    sectionCount >= MIN_SECTIONS && atomCount >= MIN_ATOMS && sectionHasRealRange;
  if (sectionCount < MIN_SECTIONS) {
    reasons.push(`segments.sections empty: ${sectionCount} (expected ${MIN_SECTIONS}+)`);
  }
  if (atomCount < MIN_ATOMS) {
    reasons.push(`segments.atoms empty: ${atomCount} (expected ${MIN_ATOMS}+)`);
  }
  if (!sectionHasRealRange) {
    reasons.push('segments.sections all have to_sec=0 (description-only fallback)');
  }

  // round to 2 decimals
  score = Math.round(score * 100) / 100;
  return {
    score,
    passed: score >= PASS_THRESHOLD && segmentsValid,
    reasons,
  };
}
