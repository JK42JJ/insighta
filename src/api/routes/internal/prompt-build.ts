/**
 * Prompt build endpoint — Mac Mini SSOT helper (CP488+ 2026-05-29).
 *
 * Returns the SAME `RICH_SUMMARY_V2_LAYERED_PROMPT` that the prod cron
 * generator uses (via `buildV2Prompt`) for the requested video. Eliminates
 * the Mac Mini PROMPT_HEADER fork that had drifted to CP446 baseline,
 * missing 4 enrichment fields (entities / sections[].relevance_pct /
 * sections[].key_points / atoms[].entity_refs) — see CP488+ post-mortem.
 *
 * Auth: x-internal-token header (shared INTERNAL_BATCH_TOKEN secret).
 *
 * Body:
 *   {
 *     videoId: string,
 *     transcript?: string,         // annotated [mm:ss] text\n form
 *     language?: 'ko' | 'en',      // overrides title-detected lang when set
 *     mandalaCenterGoal?: string   // optional center goal for relevance scoring
 *   }
 *
 * Returns 200 {
 *   prompt: string,                 // fully-resolved prompt ready for claude -p
 *   meta: {
 *     videoId, title, duration_seconds, language, transcriptChars, mandalaCenterGoalChars
 *   }
 * }
 */

import type { FastifyPluginAsync } from 'fastify';

import { getInternalBatchToken } from '@/config/internal-auth';
import { getPrismaClient } from '@/modules/database/client';
import { buildV2Prompt } from '@/modules/skills/rich-summary-v2-prompt';
import { logger } from '@/utils/logger';
import { detectContentLanguageFromTitle as detectLanguageFromTitle } from '@/utils/detect-language';

const log = logger.child({ module: 'api/internal/prompt-build' });

// CP499+ 전수 통일 — detectLanguageFromTitle now lives in @/utils/detect-language.

interface BuildV2Body {
  videoId?: string;
  transcript?: string;
  language?: string;
  mandalaCenterGoal?: string;
}

export const internalPromptBuildRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Body: BuildV2Body }>('/prompt/build-v2', async (request, reply) => {
    const expected = getInternalBatchToken();
    if (!expected) return reply.code(503).send({ error: 'internal trigger not configured' });
    const got = request.headers['x-internal-token'];
    if (typeof got !== 'string' || got !== expected) {
      return reply.code(401).send({ error: 'invalid internal token' });
    }

    const body = request.body ?? {};
    const videoId = typeof body.videoId === 'string' ? body.videoId.trim() : '';
    if (!videoId) return reply.code(400).send({ error: 'videoId required' });

    const prisma = getPrismaClient();
    const ytRow = await prisma.youtube_videos.findUnique({
      where: { youtube_video_id: videoId },
      select: { title: true, description: true, channel_title: true, duration_seconds: true },
    });
    if (!ytRow || !ytRow.title) {
      return reply.code(404).send({ error: 'youtube_videos row not found or missing title' });
    }

    const languageOverride =
      body.language === 'ko' || body.language === 'en' ? body.language : null;
    const language: 'ko' | 'en' = languageOverride ?? detectLanguageFromTitle(ytRow.title) ?? 'ko';

    const transcript = typeof body.transcript === 'string' ? body.transcript : undefined;
    const mandalaCenterGoal =
      typeof body.mandalaCenterGoal === 'string' && body.mandalaCenterGoal.trim().length > 0
        ? body.mandalaCenterGoal
        : undefined;

    const prompt = buildV2Prompt({
      title: ytRow.title,
      description: ytRow.description ?? '',
      channel: ytRow.channel_title ?? '',
      language,
      transcript,
      mandalaCenterGoal,
      durationSeconds: ytRow.duration_seconds,
    });

    log.info('prompt build-v2 returned', {
      videoId,
      language,
      durationSeconds: ytRow.duration_seconds,
      transcriptChars: transcript?.length ?? 0,
      mandalaCenterGoalChars: mandalaCenterGoal?.length ?? 0,
      promptChars: prompt.length,
    });

    return reply.code(200).send({
      prompt,
      meta: {
        videoId,
        title: ytRow.title,
        duration_seconds: ytRow.duration_seconds,
        language,
        transcriptChars: transcript?.length ?? 0,
        mandalaCenterGoalChars: mandalaCenterGoal?.length ?? 0,
      },
    });
  });
};
