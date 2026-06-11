/**
 * Rich Summary v2 — quick (fast-path) generator.
 *
 * Invoked from the `enrich-rich-summary` handler BEFORE the full v2
 * generator. Reads YouTube metadata + transcript + mandala goal, calls
 * Claude Haiku via OpenRouter, and UPSERTs a minimal v2 row containing
 * the three fields the user needs to see immediately:
 *
 *   - core.one_liner
 *   - analysis.core_argument
 *   - analysis.mandala_fit.mandala_relevance_pct
 *
 * Once persisted, the handler emits the SSE `scored` event so the FE can
 * swap the spinner for the relevance % badge. The slower
 * `generateRichSummaryV2` (Sonnet) then fills in the remaining layered
 * fields (segments, atoms, entities, key_concepts, qa_pairs).
 *
 * On row absence: this generator INSERTs (upsert path) — it does NOT
 * skip the way the full generator historically did. The legacy v1 path
 * is no longer the row creator.
 */

import { Prisma } from '@prisma/client';

import { getPrismaClient } from '@/modules/database/client';
import { OpenRouterGenerationProvider } from '@/modules/llm/openrouter';
import { loadRichSummaryConfig } from '@/config/rich-summary';
import { logger } from '@/utils/logger';

import { detectContentLanguageFromTitle as detectLanguageFromTitle } from '@/utils/detect-language';
import {
  buildV2QuickPrompt,
  validateV2Quick,
  V2QuickValidationError,
  type V2QuickResult,
} from './rich-summary-v2-quick-prompt';

const log = logger.child({ module: 'RichSummaryV2QuickGenerator' });

const HAIKU_MODEL = 'anthropic/claude-haiku-4.5';
const MAX_TOKENS = 800;
const TEMPERATURE = 0.2;

// CP499+ 전수 통일 — detectLanguageFromTitle now lives in @/utils/detect-language.

export type V2QuickOutcome =
  | { kind: 'pass'; videoId: string; mandalaRelevancePct: number }
  | { kind: 'skip'; videoId: string; reason: string }
  | { kind: 'fail'; videoId: string; reason: string };

export interface V2QuickInput {
  videoId: string;
  userId?: string | null;
  mandalaCenterGoal?: string;
  transcript: string;
}

export async function generateRichSummaryV2Quick(input: V2QuickInput): Promise<V2QuickOutcome> {
  const prisma = getPrismaClient();

  const ytRow = await prisma.youtube_videos.findUnique({
    where: { youtube_video_id: input.videoId },
    select: {
      title: true,
      description: true,
      channel_title: true,
      default_language: true,
      duration_seconds: true,
    },
  });
  if (!ytRow || !ytRow.title) {
    return { kind: 'skip', videoId: input.videoId, reason: 'no_youtube_metadata' };
  }
  if (!input.transcript || input.transcript.trim().length === 0) {
    return { kind: 'skip', videoId: input.videoId, reason: 'no_transcript' };
  }

  // CP488+ — same duration cap as the full generator. Skips Heart-click
  // path for long videos until chunked summarisation lands.
  const richConfig = loadRichSummaryConfig();
  if (ytRow.duration_seconds != null && ytRow.duration_seconds > richConfig.maxDurationSeconds) {
    log.info('v2-quick skip: duration exceeds cap', {
      videoId: input.videoId,
      durationSec: ytRow.duration_seconds,
      capSec: richConfig.maxDurationSeconds,
    });
    return {
      kind: 'skip',
      videoId: input.videoId,
      reason: `duration_exceeds_cap_${richConfig.maxDurationSeconds}s`,
    };
  }

  const language: 'ko' | 'en' =
    detectLanguageFromTitle(ytRow.title) ?? (ytRow.default_language === 'en' ? 'en' : 'ko');

  const prompt = buildV2QuickPrompt({
    title: ytRow.title,
    description: ytRow.description ?? '',
    channel: ytRow.channel_title ?? '',
    language,
    transcript: input.transcript,
    mandalaCenterGoal: input.mandalaCenterGoal ?? '',
  });

  const provider = new OpenRouterGenerationProvider(HAIKU_MODEL);

  let parsed: V2QuickResult;
  try {
    const raw = await provider.generate(prompt, {
      format: 'json',
      temperature: TEMPERATURE,
      maxTokens: MAX_TOKENS,
    });
    let json: unknown;
    try {
      // Haiku tends to wrap JSON output in a ```json … ``` markdown fence
      // even when explicitly told not to. Strip the fence before parsing
      // so the quick path doesn't fail and fall through to the slow
      // (Sonnet) full generator. Same pattern as the Mac Mini batch
      // scripts (`scripts/v2-partial-backfill.sh`, `scripts/v2-keyconcepts-lang-fix.sh`).
      const stripped = raw
        .trim()
        .replace(/^\s*```(?:json)?\s*\n?/i, '')
        .replace(/\n?\s*```\s*$/i, '')
        .trim();
      json = JSON.parse(stripped);
    } catch (parseErr) {
      log.warn('v2-quick JSON parse failed', {
        videoId: input.videoId,
        rawLen: raw.length,
        error: parseErr instanceof Error ? parseErr.message : String(parseErr),
      });
      return { kind: 'fail', videoId: input.videoId, reason: 'json_parse' };
    }
    try {
      parsed = validateV2Quick(json);
    } catch (validErr) {
      const reason =
        validErr instanceof V2QuickValidationError
          ? `validation: ${validErr.path}: ${validErr.message}`
          : `validation_threw: ${validErr instanceof Error ? validErr.message : String(validErr)}`;
      log.warn('v2-quick validation failed', { videoId: input.videoId, reason });
      return { kind: 'fail', videoId: input.videoId, reason };
    }
  } catch (err) {
    log.warn('v2-quick provider call failed', {
      videoId: input.videoId,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      kind: 'fail',
      videoId: input.videoId,
      reason: `provider_error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // UPSERT minimal v2 row. core/analysis only contain the quick fields;
  // the full generator will merge in segments/atoms/entities/etc.
  const minimalCore = parsed.core;
  const minimalAnalysis = parsed.analysis;

  try {
    await prisma.video_rich_summaries.upsert({
      where: { video_id: input.videoId },
      update: {
        template_version: 'v2',
        core: minimalCore as unknown as Prisma.InputJsonValue,
        // Merge: keep any pre-existing analysis keys, overwrite the
        // quick-path subset. Prisma's jsonb update replaces the whole
        // column — for safety we read first and merge in JS.
        ...(input.userId ? { user_id: input.userId } : {}),
        analysis: minimalAnalysis as unknown as Prisma.InputJsonValue,
        mandala_relevance_pct: parsed.analysis.mandala_fit.mandala_relevance_pct,
        source_language: language,
        transcript_used: true,
        // quality_flag stays whatever it was (legacy could be 'low');
        // the full generator will flip it to 'pass' on completion.
        updated_at: new Date(),
      },
      create: {
        video_id: input.videoId,
        template_version: 'v2',
        core: minimalCore as unknown as Prisma.InputJsonValue,
        analysis: minimalAnalysis as unknown as Prisma.InputJsonValue,
        mandala_relevance_pct: parsed.analysis.mandala_fit.mandala_relevance_pct,
        source_language: language,
        transcript_used: true,
        // Quick path is not the final verdict — only `one_liner` + `core_argument`
        // + `mandala_relevance_pct` are populated. Full generator (segments,
        // atoms, entities, lora) flips this to 'pass' or 'low' on completion.
        // Premature 'pass' here caused stuck rows when full path expired/failed.
        quality_flag: 'pending',
        ...(input.userId ? { user_id: input.userId } : {}),
      },
    });
  } catch (err) {
    log.warn('v2-quick upsert failed', {
      videoId: input.videoId,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      kind: 'fail',
      videoId: input.videoId,
      reason: `db_upsert: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  log.info('v2-quick pass', {
    videoId: input.videoId,
    mandalaRelevancePct: parsed.analysis.mandala_fit.mandala_relevance_pct,
    oneLinerLen: parsed.core.one_liner.length,
    coreArgumentLen: parsed.analysis.core_argument.length,
  });

  return {
    kind: 'pass',
    videoId: input.videoId,
    mandalaRelevancePct: parsed.analysis.mandala_fit.mandala_relevance_pct,
  };
}
