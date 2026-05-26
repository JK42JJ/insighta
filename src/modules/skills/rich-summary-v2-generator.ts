/**
 * Rich Summary v2 layered generator (CP437).
 *
 * Reads YouTube metadata for a video, generates the layered v2 schema via
 * an LLM call, validates it, and writes to the v2 columns
 * (`core` / `analysis` / `lora` / `template_version='v2'` / `completeness`).
 *
 * Hard Rule note: this file is invoked from the prod-runtime cron only —
 * `scheduler/rich-summary-v2-cron.ts` schedules per-video calls and respects
 * RICH_SUMMARY_V2_BATCH_SIZE. No standalone batch script imports this module.
 *
 * One LLM call per video (model + temperature inherited from
 * `createGenerationProvider()`). On parse/validation failure: 1 retry, then
 * mark `quality_flag='low'` per spec retry-cap.
 */

import { Prisma } from '@prisma/client';

import { getPrismaClient } from '@/modules/database/client';
import { OpenRouterGenerationProvider } from '@/modules/llm/openrouter';
import { loadRichSummaryConfig } from '@/config/rich-summary';
import { logger } from '@/utils/logger';

// CP488+ — v2 full generator pinned to Sonnet 4.6. Previously this path
// inherited the global provider (createGenerationProvider) which resolved
// to openrouter/qwen/qwen3-30b-a3b in prod and produced broken segments
// (unsorted atom timestamps, narrator-perspective summaries, back half
// uncovered). 491 rows marked `quality_flag='qwen3_low'`. Quick path
// already uses claude-haiku-4.5 explicitly; this aligns the slow path on
// the next tier up. Search-replace point for future model swaps.
const SONNET_MODEL = 'anthropic/claude-sonnet-4-6';

import {
  buildV2Prompt,
  scoreCompleteness,
  validateV2Layered,
  V2ValidationError,
  type RichSummaryV2Layered,
} from './rich-summary-v2-prompt';

const HANGUL_RANGE = /[가-힯]/g;
const LATIN_RANGE = /[A-Za-z]/g;

function detectLanguageFromTitle(title: string): 'ko' | 'en' | null {
  if (!title) return null;
  const stripped = title.replace(/\s+/g, '');
  if (stripped.length === 0) return null;
  const hangulCount = (stripped.match(HANGUL_RANGE) ?? []).length;
  const latinCount = (stripped.match(LATIN_RANGE) ?? []).length;
  const hangulRatio = hangulCount / stripped.length;
  const latinRatio = latinCount / stripped.length;
  if (hangulRatio >= 0.2) return 'ko';
  if (latinRatio >= 0.5 && hangulRatio < 0.05) return 'en';
  return null;
}

const log = logger.child({ module: 'RichSummaryV2Generator' });

const MAX_RETRIES = 1; // 1 retry → spec §7-D
// CP488+ — output token budget now sourced from config
// (RICH_SUMMARY_V2_MAX_OUTPUT_TOKENS, default 8192). Previously a
// file-local const that drifted away from the actual transcript budget
// when long videos started landing.
const TEMPERATURE = 0.3;

export type V2GenerationOutcome =
  | { kind: 'pass'; videoId: string; completeness: number }
  | { kind: 'low'; videoId: string; reason: string }
  | { kind: 'skip'; videoId: string; reason: string };

export interface V2GenerationInput {
  videoId: string;
  /**
   * `userId` is recorded in `video_rich_summaries.user_id` for accounting.
   * For cron-driven backfill we pass a synthetic `'cron'` placeholder once
   * the column accepts text; spec § future-work moves this to a dedicated
   * `'system'` user. For now, fall back to `null` (column is nullable).
   */
  userId?: string | null;
  /**
   * Optional transcript text supplied by the Mac Mini transcript pipeline
   * (yt-dlp memory-only, never persisted). When present, the prompt
   * instructs the LLM to prefer transcript-derived evidence. Caller is
   * responsible for the legal directive: NEVER store the raw transcript
   * in any column.
   */
  transcript?: string;
  /**
   * When true, the generator stamps `youtube_videos.transcript_fetched_at`
   * to NOW() after a successful pass. Set by the Mac Mini route only.
   */
  stampTranscriptFetchedAt?: boolean;
  /**
   * CP462+ Issue #649 — mandala center_goal text. Passed straight into the
   * prompt so the LLM can compute `analysis.mandala_fit.mandala_relevance_pct`.
   * Omitted (or empty) ⇒ the model is instructed to return 0 for that field
   * and the score on the row stays low — that is the correct behaviour for
   * cron-driven backfill which does not know which user triggered the video.
   */
  mandalaCenterGoal?: string;
  /** CP474 — bypass the "complete v2" skip gate so a description-only row
   *  can be regenerated when a transcript becomes available. */
  forceRegen?: boolean;
}

export async function generateRichSummaryV2(
  input: V2GenerationInput
): Promise<V2GenerationOutcome> {
  const prisma = getPrismaClient();

  // Fetch row + metadata in one round-trip
  const row = await prisma.video_rich_summaries.findUnique({
    where: { video_id: input.videoId },
    select: {
      video_id: true,
      template_version: true,
      source_language: true,
      quality_flag: true,
      mandala_relevance_pct: true,
      // CP474 — only "transcript-grounded v2" is skip-worthy.
      transcript_used: true,
    },
  });
  // CP475+ — v1 path no longer creates the row in the enrich handler.
  // The fast-path `generateRichSummaryV2Quick` upserts a minimal v2 row
  // before this full generator runs, so the row should normally exist.
  // If it still doesn't (quick path failed / standalone cron call), the
  // UPSERT branches below (line ~203 + ~265) auto-INSERT — drop the
  // legacy skip so this path never silently no-ops.
  // (Original guard kept commented for traceability.)
  // if (!row) {
  //   return { kind: 'skip', videoId: input.videoId, reason: 'no_rich_summary_row' };
  // }
  // description-only rows fall through so the next Heart click with a
  // working captioner can regenerate. forceRegen overrides.
  if (
    row &&
    !input.forceRegen &&
    row.template_version === 'v2' &&
    row.mandala_relevance_pct != null &&
    row.transcript_used
  ) {
    return { kind: 'skip', videoId: input.videoId, reason: 'already_v2_with_transcript' };
  }

  const ytRow = await prisma.youtube_videos.findUnique({
    where: { youtube_video_id: input.videoId },
    select: { title: true, description: true, channel_title: true, duration_seconds: true },
  });
  if (!ytRow || !ytRow.title) {
    return { kind: 'skip', videoId: input.videoId, reason: 'no_youtube_metadata' };
  }

  // CP488+ — duration cap. Videos longer than the configured cap (default
  // 90min) skip v2 generation. The generator code path stays in place
  // (no behavioural change beyond this guard) so flipping the env opens
  // it back up without a code change. Long-form chunked summarisation
  // is the follow-up that would justify raising the cap.
  const richConfig = loadRichSummaryConfig();
  if (ytRow.duration_seconds != null && ytRow.duration_seconds > richConfig.maxDurationSeconds) {
    log.info('v2 skip: duration exceeds cap', {
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

  // Title-based language override — `source_language` is stamped from the
  // transcript track YouTube returned, which is sometimes the wrong track
  // (e.g. auto-translated EN captions for a Korean video). Trust the title:
  // if hangul ratio is high enough, force 'ko'; if it's clearly Latin-only,
  // force 'en'. Only fall back to source_language for ambiguous cases.
  const language: 'ko' | 'en' =
    detectLanguageFromTitle(ytRow.title) ?? (row?.source_language === 'en' ? 'en' : 'ko');
  const prompt = buildV2Prompt({
    title: ytRow.title,
    description: ytRow.description ?? '',
    channel: ytRow.channel_title ?? '',
    language,
    transcript: input.transcript,
    mandalaCenterGoal: input.mandalaCenterGoal,
  });

  // CP488+ — pinned Sonnet 4.6 (see SONNET_MODEL doc-comment above).
  const provider = new OpenRouterGenerationProvider(SONNET_MODEL);

  let lastReason = 'unknown_error';
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const raw = await provider.generate(prompt, {
        format: 'json',
        temperature: TEMPERATURE,
        maxTokens: richConfig.maxOutputTokens,
      });
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.trim());
      } catch (parseErr) {
        lastReason = `json_parse_failed: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`;
        log.warn('v2 JSON parse failed', {
          videoId: input.videoId,
          attempt,
          rawLen: raw.length,
        });
        continue;
      }
      let summary: RichSummaryV2Layered;
      try {
        summary = validateV2Layered(parsed);
      } catch (validErr) {
        const reason =
          validErr instanceof V2ValidationError
            ? `validation_failed: ${validErr.path}: ${validErr.message}`
            : `validation_threw: ${validErr instanceof Error ? validErr.message : String(validErr)}`;
        lastReason = reason;
        log.warn('v2 validation failed', {
          videoId: input.videoId,
          attempt,
          reason,
        });
        continue;
      }
      const score = scoreCompleteness(summary);
      if (!score.passed) {
        lastReason = `completeness_${score.score}_below_threshold`;
        log.info('v2 completeness below threshold', {
          videoId: input.videoId,
          attempt,
          score: score.score,
          reasons: score.reasons,
        });
        continue;
      }

      // UPSERT — the quick-path normally creates the row first, but
      // standalone callers (cron / scripts) may invoke this generator
      // without the quick step. INSERT branch covers that case.
      await prisma.video_rich_summaries.upsert({
        where: { video_id: input.videoId },
        update: {
          template_version: 'v2',
          core: summary.core as unknown as Prisma.InputJsonValue,
          analysis: summary.analysis as unknown as Prisma.InputJsonValue,
          lora: summary.lora as unknown as Prisma.InputJsonValue,
          // CP474 — persist segments emitted by the same LLM call.
          // Optional: when the LLM omits segments (transcript absent or
          // model declined), leave the column NULL via undefined so
          // existing rows aren't accidentally cleared.
          ...(summary.segments
            ? { segments: summary.segments as unknown as Prisma.InputJsonValue }
            : {}),
          completeness: score.score,
          quality_flag: 'pass',
          model: provider.model,
          mandala_relevance_pct: summary.analysis.mandala_fit.mandala_relevance_pct,
          // CP474 — true only when the LLM actually saw a transcript.
          transcript_used: Boolean(input.transcript && input.transcript.length > 0),
          ...(input.userId ? { user_id: input.userId } : {}),
          updated_at: new Date(),
        },
        create: {
          video_id: input.videoId,
          template_version: 'v2',
          core: summary.core as unknown as Prisma.InputJsonValue,
          analysis: summary.analysis as unknown as Prisma.InputJsonValue,
          lora: summary.lora as unknown as Prisma.InputJsonValue,
          ...(summary.segments
            ? { segments: summary.segments as unknown as Prisma.InputJsonValue }
            : {}),
          completeness: score.score,
          quality_flag: 'pass',
          model: provider.model,
          mandala_relevance_pct: summary.analysis.mandala_fit.mandala_relevance_pct,
          source_language: language,
          transcript_used: Boolean(input.transcript && input.transcript.length > 0),
          ...(input.userId ? { user_id: input.userId } : {}),
        },
      });

      // Stamp transcript_fetched_at on the video row when the Mac Mini
      // pipeline successfully fed a transcript through. Persisting only
      // the timestamp — the transcript text is never written to DB.
      if (input.stampTranscriptFetchedAt) {
        try {
          await prisma.youtube_videos.update({
            where: { youtube_video_id: input.videoId },
            data: { transcript_fetched_at: new Date() },
          });
        } catch (err) {
          log.warn('transcript_fetched_at stamp failed (non-fatal)', {
            videoId: input.videoId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      log.info('v2 generated', {
        videoId: input.videoId,
        attempt,
        completeness: score.score,
        domain: summary.core.domain,
        withTranscript: Boolean(input.transcript && input.transcript.length > 0),
      });
      return { kind: 'pass', videoId: input.videoId, completeness: score.score };
    } catch (err) {
      lastReason = `provider_error: ${err instanceof Error ? err.message : String(err)}`;
      log.warn('v2 provider call failed', {
        videoId: input.videoId,
        attempt,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // All attempts failed → mark `low` so the cron does not retry indefinitely
  // (spec §7-D: 1 retry → 'low' permanent until manual intervention).
  // UPSERT covers the case where the quick path also failed (row absent).
  await prisma.video_rich_summaries.upsert({
    where: { video_id: input.videoId },
    update: {
      template_version: 'v2',
      quality_flag: 'low',
      completeness: 0,
      ...(input.userId ? { user_id: input.userId } : {}),
      updated_at: new Date(),
    },
    create: {
      video_id: input.videoId,
      template_version: 'v2',
      quality_flag: 'low',
      completeness: 0,
      source_language: language,
      ...(input.userId ? { user_id: input.userId } : {}),
    },
  });
  log.warn('v2 marked low after retries exhausted', {
    videoId: input.videoId,
    reason: lastReason,
  });
  return { kind: 'low', videoId: input.videoId, reason: lastReason };
}
