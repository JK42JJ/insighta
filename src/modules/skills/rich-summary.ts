/**
 * Rich Summary Generator — enrichRichSummary()
 *
 * Generates structured summary + quality validation for video_rich_summaries table.
 * Always generates structured output (tier-independent) — one_liner extracted from core_argument.
 *
 * Integration: called after enrichVideo() succeeds (non-fatal).
 * Design: docs/design/skill-registry-handoff.md Step 3
 */

import { getPrismaClient } from '@/modules/database/client';
import { createGenerationProvider } from '@/modules/llm';
import { logger } from '@/utils/logger';
import { checkSummaryQuality } from './summary-gate';
import { isV2Summary, type RichSummary } from './rich-summary-types';
import { loadRichSummaryConfig } from '@/config/rich-summary';
import { assertRichSummaryQuota } from './rich-summary-quota';
import { bridgeRichSummaryToKG } from '@/modules/ontology/kg-bridge';
import { Prisma } from '@prisma/client';

export interface RichSummarySegment {
  start_sec: number;
  text: string;
}

function formatSegmentsBlock(segments: RichSummarySegment[] | undefined): string {
  if (!segments || segments.length === 0) return '';
  const capped = segments.slice(0, TIMESTAMPED_SEGMENTS_LIMIT);
  return capped.map((s) => `[${Math.round(s.start_sec)}s] ${s.text}`).join('\n');
}

const log = logger.child({ module: 'RichSummary' });

const MAX_RETRIES = 1;
const TRANSCRIPT_CHUNK_SIZE = 3000;
const DESCRIPTION_CHUNK_SIZE = 1000;
const DESCRIPTION_PROMPT_LIMIT = 500;
const TIMESTAMPED_SEGMENTS_LIMIT = 120; // cap timestamped lines passed to LLM

// ---------------------------------------------------------------------------
// Prompts — v2 (KG Bridge + Learning Interface, #500)
// ---------------------------------------------------------------------------

const RICH_SUMMARY_V2_PROMPT = `You are a learning content analysis expert.
Analyze the following YouTube video and respond ONLY in valid JSON. No other text.

Video title: {title}
Video description: {description}
Transcript summary: {transcript_chunk}
Timestamped segments (may be empty): {segments_block}

Respond with this exact JSON structure:
{{
  "core_argument": "Core thesis of this video (1 sentence, 10-150 chars)",
  "entities": [
    {{"name": "Entity name", "type": "concept"}},
    {{"name": "Person name", "type": "person"}}
  ],
  "atoms": [
    {{"text": "Atomic insight or fact (1-2 sentences)", "timestamp_sec": 120, "entity_refs": ["Entity name"]}},
    {{"text": "Another insight", "entity_refs": []}}
  ],
  "sections": [
    {{
      "from_sec": 0,
      "to_sec": 102,
      "title": "Section title",
      "summary": "What this section covers (1 sentence)",
      "relevance_pct": 65,
      "key_points": [
        {{"text": "Key point from this section", "timestamp_sec": 45}}
      ]
    }}
  ],
  "actionables": ["Immediately actionable items after watching"],
  "prerequisites": ["Required prior knowledge (empty array if none)"],
  "bias_signals": ["Commercial intent", "Exaggerated claims", "Unsourced claims"],
  "content_type": "tutorial",
  "depth_level": "beginner",
  "mandala_fit": {{
    "suggested_topics": ["keyword1", "keyword2"],
    "relevance_rationale": "One line explanation"
  }},
  "tl_dr_ko": "200자 이내 한글 요약",
  "tl_dr_en": "200-char English summary"
}}

Field rules:
- entities: Extract 2-8 key concepts/people/tools/frameworks/organizations mentioned. type must be one of: concept, person, tool, framework, organization. Deduplicate by name (case-insensitive).
- atoms: Extract 3-8 atomic insights or facts. Each atom is a standalone claim. entity_refs links to entity names. timestamp_sec is optional (use when derivable from segments).
- sections: Divide the video into 3-8 logical sections. from_sec/to_sec are integers from segment timestamps. relevance_pct (0-100) indicates how relevant this section is to the video's core argument. Each section has 1-3 key_points.
- content_type: tutorial | opinion | research | news | entertainment
- depth_level: beginner | intermediate | advanced

When "Timestamped segments" is empty:
- sections: return 1 section covering the whole video (from_sec: 0, to_sec: 0) with key_points from title/description. Set relevance_pct to 50.
- atoms: derive from title + description without timestamp_sec.
- tl_dr_ko + tl_dr_en are ALWAYS required (fall back to title + description).`;

const ONE_LINER_PROMPT = `Summarize the following YouTube video in one Korean sentence (under 30 characters).
Video title: {title}
Video description: {description}
Output only the summary sentence.`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RichSummaryResult {
  videoId: string;
  oneLiner: string | null;
  structured: RichSummary | null;
  qualityScore: number;
  qualityFlag: 'pass' | 'low' | 'failed';
  model: string | null;
}

// ---------------------------------------------------------------------------
// Core function
// ---------------------------------------------------------------------------

export async function enrichRichSummary(
  videoId: string,
  options: {
    userId: string;
    title: string;
    description?: string;
    transcript?: string;
    segments?: RichSummarySegment[];
  }
): Promise<RichSummaryResult> {
  const prisma = getPrismaClient();
  const config = loadRichSummaryConfig();

  if (!config.enabled) {
    log.info('Rich summary feature disabled (RICH_SUMMARY_ENABLED=false) — skipping', {
      videoId,
    });
    return {
      videoId,
      oneLiner: null,
      structured: null,
      qualityScore: 0,
      qualityFlag: 'failed',
      model: null,
    };
  }

  // Check if already exists with passing quality (cache hit → does NOT consume quota)
  const existing = await prisma.video_rich_summaries.findUnique({
    where: { video_id: videoId },
  });
  if (existing && existing.quality_flag === 'pass') {
    log.info('Rich summary cache hit', { videoId });
    return {
      videoId,
      oneLiner: existing.one_liner,
      structured: existing.structured as RichSummary | null,
      qualityScore: existing.quality_score ?? 0,
      qualityFlag: 'pass',
      model: existing.model,
    };
  }

  // CP423: enforce per-user monthly quota before LLM call.
  const quota = await assertRichSummaryQuota(prisma, options.userId);
  log.info('Rich summary quota check passed', {
    userId: options.userId,
    tier: quota.tier,
    used: quota.used,
    limit: quota.limit,
  });

  const generationProvider = await createGenerationProvider();
  const generate = (prompt: string, opts?: { format?: 'json' | 'text'; temperature?: number }) =>
    generationProvider.generate(prompt, opts);

  const transcriptChunk = options.transcript
    ? options.transcript.slice(0, TRANSCRIPT_CHUNK_SIZE)
    : (options.description ?? '').slice(0, DESCRIPTION_CHUNK_SIZE);
  const segmentsBlock = formatSegmentsBlock(options.segments);

  // Attempt structured summary generation (with retry)
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const prompt = RICH_SUMMARY_V2_PROMPT.replace('{title}', options.title)
        .replace('{description}', (options.description ?? '').slice(0, DESCRIPTION_PROMPT_LIMIT))
        .replace('{transcript_chunk}', transcriptChunk)
        .replace('{segments_block}', segmentsBlock);

      const raw = await generate(prompt, { format: 'json', temperature: 0.3 });
      const structured = JSON.parse(raw.trim()) as RichSummary;
      const result = checkSummaryQuality(structured);

      if (result.passed) {
        const oneLiner = structured.core_argument ?? '';

        await upsertRichSummary(prisma, videoId, {
          oneLiner,
          structured,
          qualityScore: result.score,
          qualityFlag: 'pass',
          model: generationProvider.model,
          userId: options.userId,
        });

        log.info('Rich summary generated (pass)', {
          videoId,
          score: result.score,
          attempt,
        });

        // KG Bridge: auto-convert v2 summaries to ontology nodes/edges (#506)
        if (isV2Summary(structured)) {
          setImmediate(() => {
            bridgeRichSummaryToKG(videoId, options.userId, structured)
              .then((bridgeResult) => log.info('KG Bridge completed', { videoId, ...bridgeResult }))
              .catch((err: unknown) => {
                log.warn('KG Bridge failed (non-fatal)', {
                  videoId,
                  error: err instanceof Error ? err.message : String(err),
                });
              });
          });
        }

        return {
          videoId,
          oneLiner,
          structured,
          qualityScore: result.score,
          qualityFlag: 'pass',
          model: generationProvider.model,
        };
      }

      log.warn('Rich summary quality check failed', {
        videoId,
        score: result.score,
        reasons: result.reasons,
        attempt,
      });
    } catch (err) {
      log.warn('Rich summary generation error', {
        videoId,
        attempt,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // All attempts failed → one_liner fallback
  let oneLiner: string | null = null;
  try {
    const fallbackPrompt = ONE_LINER_PROMPT.replace('{title}', options.title).replace(
      '{description}',
      (options.description ?? '').slice(0, DESCRIPTION_PROMPT_LIMIT)
    );
    oneLiner = (await generate(fallbackPrompt, { temperature: 0.3 })).trim();
  } catch {
    log.error('One-liner fallback also failed', { videoId });
  }

  await upsertRichSummary(prisma, videoId, {
    oneLiner,
    structured: null,
    qualityScore: 0,
    qualityFlag: 'low',
    model: generationProvider.model,
    userId: options.userId,
  });

  log.info('Rich summary fallback to one_liner', { videoId });

  return {
    videoId,
    oneLiner,
    structured: null,
    qualityScore: 0,
    qualityFlag: 'low',
    model: generationProvider.model,
  };
}

// ---------------------------------------------------------------------------
// DB helper
// ---------------------------------------------------------------------------

async function upsertRichSummary(
  prisma: ReturnType<typeof getPrismaClient>,
  videoId: string,
  data: {
    oneLiner: string | null;
    structured: RichSummary | null;
    qualityScore: number;
    qualityFlag: string;
    model: string | null;
    userId: string;
  }
): Promise<void> {
  const structuredJson = data.structured
    ? (data.structured as unknown as Prisma.InputJsonValue)
    : Prisma.JsonNull;

  await prisma.video_rich_summaries.upsert({
    where: { video_id: videoId },
    update: {
      one_liner: data.oneLiner,
      structured: structuredJson,
      quality_score: data.qualityScore,
      quality_flag: data.qualityFlag,
      model: data.model,
      user_id: data.userId,
      updated_at: new Date(),
    },
    create: {
      video_id: videoId,
      tier_required: 'free',
      one_liner: data.oneLiner,
      structured: structuredJson,
      quality_score: data.qualityScore,
      quality_flag: data.qualityFlag,
      model: data.model,
      user_id: data.userId,
    },
  });
}
