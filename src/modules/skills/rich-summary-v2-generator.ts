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
import { createGenerationProvider } from '@/modules/llm';
import { logger } from '@/utils/logger';

import {
  buildV2Prompt,
  scoreCompleteness,
  validateV2Layered,
  V2ValidationError,
  type RichSummaryV2Layered,
} from './rich-summary-v2-prompt';

const log = logger.child({ module: 'RichSummaryV2Generator' });

const MAX_RETRIES = 1; // 1 retry → spec §7-D
const MAX_TOKENS = 4096;
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
  if (!row) {
    return { kind: 'skip', videoId: input.videoId, reason: 'no_rich_summary_row' };
  }
  // CP474 — description-only v2 rows fall through so a later Heart click
  // with a successful captioner can regenerate them. forceRegen overrides.
  if (
    !input.forceRegen &&
    row.template_version === 'v2' &&
    row.mandala_relevance_pct != null &&
    row.transcript_used
  ) {
    return { kind: 'skip', videoId: input.videoId, reason: 'already_v2_with_transcript' };
  }

  const ytRow = await prisma.youtube_videos.findUnique({
    where: { youtube_video_id: input.videoId },
    select: { title: true, description: true, channel_title: true },
  });
  if (!ytRow || !ytRow.title) {
    return { kind: 'skip', videoId: input.videoId, reason: 'no_youtube_metadata' };
  }

  const language: 'ko' | 'en' = row.source_language === 'en' ? 'en' : 'ko';
  const prompt = buildV2Prompt({
    title: ytRow.title,
    description: ytRow.description ?? '',
    channel: ytRow.channel_title ?? '',
    language,
    transcript: input.transcript,
    mandalaCenterGoal: input.mandalaCenterGoal,
  });

  const provider = await createGenerationProvider();

  let lastReason = 'unknown_error';
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const raw = await provider.generate(prompt, {
        format: 'json',
        temperature: TEMPERATURE,
        maxTokens: MAX_TOKENS,
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

      await prisma.video_rich_summaries.update({
        where: { video_id: input.videoId },
        data: {
          template_version: 'v2',
          core: summary.core as unknown as Prisma.InputJsonValue,
          analysis: summary.analysis as unknown as Prisma.InputJsonValue,
          lora: summary.lora as unknown as Prisma.InputJsonValue,
          completeness: score.score,
          quality_flag: 'pass',
          model: provider.model,
          mandala_relevance_pct: summary.analysis.mandala_fit.mandala_relevance_pct,
          // CP474 — true only when the LLM actually saw a transcript.
          transcript_used: Boolean(input.transcript && input.transcript.length > 0),
          ...(input.userId ? { user_id: input.userId } : {}),
          updated_at: new Date(),
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
  await prisma.video_rich_summaries.update({
    where: { video_id: input.videoId },
    data: {
      template_version: 'v2',
      quality_flag: 'low',
      completeness: 0,
      ...(input.userId ? { user_id: input.userId } : {}),
      updated_at: new Date(),
    },
  });
  log.warn('v2 marked low after retries exhausted', {
    videoId: input.videoId,
    reason: lastReason,
  });
  return { kind: 'low', videoId: input.videoId, reason: lastReason };
}
