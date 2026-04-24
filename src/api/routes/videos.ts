/**
 * Video API Routes
 *
 * REST API endpoints for video management
 */

import { FastifyPluginCallback } from 'fastify';
import { getVideoManager } from '../../modules/video';
import { getCaptionExtractor } from '../../modules/caption/extractor';
import { getPrismaClient } from '../../modules/database';
import { getYouTubeClient } from '../client';
import { loadYouTubeOAuth } from '../plugins/youtube-oauth';
import { fork } from 'child_process';
import { resolve } from 'path';
import {
  ListVideosQuerySchema,
  GetVideoParamsSchema,
  GetCaptionsQuerySchema,
  GenerateSummaryRequestSchema,
  listVideosSchema,
  getVideoSchema,
  getCaptionsSchema,
  getCaptionLanguagesSchema,
  getSummarySchema,
  generateSummarySchema,
  type ListVideosQuery,
  type GetVideoParams,
  type GetCaptionsQuery,
  type GenerateSummaryRequest,
  type VideoResponse,
  type VideoWithStateResponse,
  type ListVideosResponse,
  type CaptionResponse,
  type AvailableLanguagesResponse,
  type SummaryResponse,
} from '../schemas/video.schema';
import { logger } from '../../utils/logger';
import { createErrorResponse, ErrorCode } from '../schemas/common.schema';

const SUMMARY_WORD_LIMITS = {
  brief: 100,
  detailed: 300,
  comprehensive: 500,
} as const;

/**
 * Video routes plugin
 *
 * Note: Managers are lazily loaded in each route handler to avoid
 * initializing YouTube API client at plugin registration time.
 */
export const videoRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  // Load YouTube OAuth credentials for all routes in this plugin
  fastify.addHook('preHandler', loadYouTubeOAuth);

  // Lazy getters for managers - only initialize when actually needed
  const getVideo = () => getVideoManager();
  const getCaption = () => getCaptionExtractor();
  const getDb = () => getPrismaClient();

  /**
   * GET /api/v1/videos/search - Search YouTube videos by keyword
   */
  fastify.get<{
    Querystring: { q: string; maxResults?: number };
    Reply: {
      videos: Array<{
        videoId: string;
        title: string;
        channelTitle: string;
        thumbnail: string;
        publishedAt: string;
      }>;
    };
  }>(
    '/search',
    {
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      if (!request.user || !('userId' in request.user)) {
        throw new Error('Unauthorized');
      }

      const { q, maxResults } = request.query;
      if (!q || q.trim().length === 0) {
        return reply.code(400).send({ error: 'Query parameter "q" is required' } as any);
      }

      const limit = Math.min(maxResults ?? 20, 50);
      logger.info('Searching YouTube videos', {
        query: q,
        maxResults: limit,
        userId: request.user.userId,
      });

      const ytClient = getYouTubeClient();
      const results = await ytClient.searchVideos(q.trim(), limit);

      const videos = results
        .filter((r) => r.id?.videoId)
        .map((r) => ({
          videoId: r.id!.videoId!,
          title: r.snippet?.title ?? '',
          channelTitle: r.snippet?.channelTitle ?? '',
          thumbnail:
            r.snippet?.thumbnails?.medium?.url ?? r.snippet?.thumbnails?.default?.url ?? '',
          publishedAt: r.snippet?.publishedAt ?? '',
        }));

      return reply.code(200).send({ videos });
    }
  );

  /**
   * GET /api/v1/videos - List videos
   */
  fastify.get<{ Querystring: ListVideosQuery; Reply: ListVideosResponse }>(
    '/',
    {
      schema: listVideosSchema,
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      // Type guard for authenticated user
      if (!request.user || !('userId' in request.user)) {
        throw new Error('Unauthorized');
      }

      const validatedQuery = ListVideosQuerySchema.parse(request.query);

      logger.info('Listing videos', { userId: request.user.userId, query: validatedQuery });

      // Build where clause
      const where: any = {};

      // Filter by playlist
      if (validatedQuery.playlistId) {
        where.youtube_playlist_items = {
          some: {
            playlist_id: validatedQuery.playlistId,
            removed_at: null,
          },
        };
      }

      // Filter by search
      if (validatedQuery.search) {
        where.OR = [
          { title: { contains: validatedQuery.search } },
          { description: { contains: validatedQuery.search } },
        ];
      }

      // Build order by
      const orderBy: any = {};
      if (validatedQuery.sortBy === 'publishedAt') {
        orderBy['published_at'] = validatedQuery.sortOrder;
      } else if (validatedQuery.sortBy === 'duration') {
        orderBy['duration_seconds'] = validatedQuery.sortOrder;
      } else if (validatedQuery.sortBy === 'viewCount') {
        orderBy['view_count'] = validatedQuery.sortOrder;
      } else if (validatedQuery.sortBy === 'title') {
        orderBy['title'] = validatedQuery.sortOrder;
      } else {
        orderBy['published_at'] = 'desc';
      }

      // Calculate pagination
      const skip = (validatedQuery.page - 1) * validatedQuery.limit;

      // Fetch videos
      const [videos, total] = await Promise.all([
        getDb().youtube_videos.findMany({
          where,
          orderBy,
          skip,
          take: validatedQuery.limit,
        }),
        getDb().youtube_videos.count({ where }),
      ]);

      const videoResponses: VideoResponse[] = videos.map((v) => ({
        id: v.id,
        youtubeId: v.youtube_video_id,
        title: v.title,
        description: v.description ?? null,
        channelId: '',
        channelTitle: v.channel_title ?? '',
        duration: v.duration_seconds ?? 0,
        thumbnailUrls: v.thumbnail_url ?? '',
        viewCount: v.view_count ? Number(v.view_count) : 0,
        likeCount: v.like_count ? Number(v.like_count) : 0,
        commentCount: 0,
        publishedAt: v.published_at ? v.published_at.toISOString() : v.created_at.toISOString(),
        tags: null,
        categoryId: null,
        language: null,
        createdAt: v.created_at.toISOString(),
        updatedAt: v.updated_at.toISOString(),
      }));

      const totalPages = Math.ceil(total / validatedQuery.limit);

      const response: ListVideosResponse = {
        videos: videoResponses,
        total,
        page: validatedQuery.page,
        limit: validatedQuery.limit,
        totalPages,
      };

      return reply.code(200).send(response);
    }
  );

  /**
   * GET /api/v1/videos/:id - Get video details
   */
  fastify.get<{ Params: GetVideoParams; Reply: { video: VideoWithStateResponse } }>(
    '/:id',
    {
      schema: getVideoSchema,
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      // Type guard for authenticated user
      if (!request.user || !('userId' in request.user)) {
        throw new Error('Unauthorized');
      }

      const validatedParams = GetVideoParamsSchema.parse(request.params);
      const { id } = validatedParams;

      logger.info('Getting video details', { videoId: id, userId: request.user.userId });

      const videoWithState = await getVideo().getVideoWithState(id, request.user.userId);

      const response: VideoWithStateResponse = {
        id: videoWithState.id,
        youtubeId: videoWithState.youtube_video_id,
        title: videoWithState.title,
        description: videoWithState.description ?? null,
        channelId: '',
        channelTitle: videoWithState.channel_title ?? '',
        duration: videoWithState.duration_seconds ?? 0,
        thumbnailUrls: videoWithState.thumbnail_url ?? '',
        viewCount: videoWithState.view_count ? Number(videoWithState.view_count) : 0,
        likeCount: videoWithState.like_count ? Number(videoWithState.like_count) : 0,
        commentCount: 0,
        publishedAt: videoWithState.published_at
          ? videoWithState.published_at.toISOString()
          : videoWithState.created_at.toISOString(),
        tags: null,
        categoryId: null,
        language: null,
        createdAt: videoWithState.created_at.toISOString(),
        updatedAt: videoWithState.updated_at.toISOString(),
        userState: videoWithState.userState
          ? {
              watchStatus: videoWithState.userState.is_watched ? 'COMPLETED' : 'UNWATCHED',
              lastPosition: videoWithState.userState.watch_position_seconds ?? 0,
              watchCount: 0,
              notes: videoWithState.userState.user_note ?? null,
              summary: null,
              tags: null,
              rating: null,
              createdAt: videoWithState.userState.createdAt.toISOString(),
              updatedAt: videoWithState.userState.updatedAt.toISOString(),
            }
          : null,
      };

      return reply.code(200).send({ video: response });
    }
  );

  /**
   * GET /api/v1/videos/:id/captions - Get captions
   */
  fastify.get<{
    Params: GetVideoParams;
    Querystring: GetCaptionsQuery;
    Reply: { caption: CaptionResponse };
  }>(
    '/:id/captions',
    {
      schema: getCaptionsSchema,
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      // Type guard for authenticated user
      if (!request.user || !('userId' in request.user)) {
        throw new Error('Unauthorized');
      }

      const validatedParams = GetVideoParamsSchema.parse(request.params);
      const validatedQuery = GetCaptionsQuerySchema.parse(request.query);
      const { id } = validatedParams;
      const { language } = validatedQuery;

      logger.info('Getting captions', { videoId: id, language, userId: request.user.userId });

      // Get video to get YouTube ID
      const video = await getVideo().getVideo(id);

      // Extract captions (will use cached if available)
      const result = await getCaption().extractCaptions(video.youtube_video_id, language);

      if (!result.success || !result.caption) {
        const error = createErrorResponse(
          ErrorCode.RESOURCE_NOT_FOUND,
          result.error || 'Captions not found',
          request.url
        );
        return reply.code(404).send(error as any);
      }

      const response: CaptionResponse = {
        videoId: result.caption.videoId,
        language: result.caption.language,
        fullText: result.caption.fullText,
        segments: result.caption.segments,
      };

      return reply.code(200).send({ caption: response });
    }
  );

  /**
   * GET /api/v1/videos/:id/captions/languages - Available caption languages
   */
  fastify.get<{ Params: GetVideoParams; Reply: AvailableLanguagesResponse }>(
    '/:id/captions/languages',
    {
      schema: getCaptionLanguagesSchema,
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      // Type guard for authenticated user
      if (!request.user || !('userId' in request.user)) {
        throw new Error('Unauthorized');
      }

      const validatedParams = GetVideoParamsSchema.parse(request.params);
      const { id } = validatedParams;

      logger.info('Getting available caption languages', {
        videoId: id,
        userId: request.user.userId,
      });

      // Get video to get YouTube ID
      const video = await getVideo().getVideo(id);

      // Get available languages
      const result = await getCaption().getAvailableLanguages(video.youtube_video_id);

      const response: AvailableLanguagesResponse = {
        videoId: result.videoId,
        languages: result.languages,
      };

      return reply.code(200).send(response);
    }
  );

  /**
   * GET /api/v1/videos/:id/summary - Get summary
   */
  fastify.get<{ Params: GetVideoParams; Reply: { summary: SummaryResponse } }>(
    '/:id/summary',
    {
      schema: getSummarySchema,
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      // Type guard for authenticated user
      if (!request.user || !('userId' in request.user)) {
        throw new Error('Unauthorized');
      }

      const validatedParams = GetVideoParamsSchema.parse(request.params);
      const { id } = validatedParams;

      logger.info('Getting summary', { videoId: id, userId: request.user.userId });

      // Get video with state
      const videoWithState = await getVideo().getVideoWithState(id, request.user.userId);

      // Check if summary exists - summary is not a direct field in the new schema
      // user_note serves as general notes; no dedicated summary field in UserVideoState
      if (!videoWithState.userState || !videoWithState.userState.user_note) {
        const error = createErrorResponse(
          ErrorCode.RESOURCE_NOT_FOUND,
          'Summary not found for this video. Generate it first using POST /videos/:id/summary',
          request.url
        );
        return reply.code(404).send(error as any);
      }

      const response: SummaryResponse = {
        videoId: videoWithState.youtube_video_id,
        summary: videoWithState.userState.user_note,
        level: 'brief', // Default, could be stored separately
        language: 'en', // Default, could be stored separately
        generatedAt: videoWithState.userState.updatedAt.toISOString(),
      };

      return reply.code(200).send({ summary: response });
    }
  );

  /**
   * POST /api/v1/videos/:id/summary - Generate summary
   */
  fastify.post<{
    Params: GetVideoParams;
    Body: GenerateSummaryRequest;
    Reply: { summary: SummaryResponse };
  }>(
    '/:id/summary',
    {
      schema: generateSummarySchema,
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      // Type guard for authenticated user
      if (!request.user || !('userId' in request.user)) {
        throw new Error('Unauthorized');
      }

      const validatedParams = GetVideoParamsSchema.parse(request.params);
      const validatedBody = GenerateSummaryRequestSchema.parse(request.body);
      const { id } = validatedParams;
      const { level, language } = validatedBody;

      logger.info('Generating summary', {
        videoId: id,
        level,
        language,
        userId: request.user.userId,
      });

      // Get video
      const video = await getVideo().getVideo(id);

      // Extract captions first
      const captionResult = await getCaption().extractCaptions(video.youtube_video_id, language);

      if (!captionResult.success || !captionResult.caption) {
        const error = createErrorResponse(
          ErrorCode.RESOURCE_NOT_FOUND,
          'Unable to extract captions for summary generation',
          request.url
        );
        return reply.code(404).send(error as any);
      }

      // TODO: Implement actual summarization using AI
      // For now, create a simple summary from captions
      const fullText = captionResult.caption.fullText;
      const words = fullText.split(' ');
      const wordLimit =
        SUMMARY_WORD_LIMITS[level as keyof typeof SUMMARY_WORD_LIMITS] ?? SUMMARY_WORD_LIMITS.brief;
      const summaryText = words.slice(0, wordLimit).join(' ') + '...';

      // Save summary to user state via notes field
      await getVideo().addNotes(id, request.user.userId, summaryText);

      const response: SummaryResponse = {
        videoId: video.youtube_video_id,
        summary: summaryText,
        level,
        language,
        generatedAt: new Date().toISOString(),
      };

      logger.info('Summary generated successfully', { videoId: id });

      return reply.code(200).send({ summary: response });
    }
  );

  // POST /enrich-cards — trigger batch enrichment for user's unenriched YouTube cards
  // Creates video_summaries entries which the local-cards EF JOINs to show summaries
  const ENRICH_LIMIT = 50;
  const ENRICH_DELAY_MS = 2000;

  fastify.post('/enrich-cards', { onRequest: [fastify.authenticate] }, async (_request, reply) => {
    const workerPath = resolve(__dirname, '../../modules/ontology/enrich-worker.js');
    try {
      const child = fork(workerPath, [], {
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        detached: true,
      });
      child.send({ limit: ENRICH_LIMIT, delayMs: ENRICH_DELAY_MS });
      child.unref();
      logger.info('User-triggered enrichment started', { limit: ENRICH_LIMIT });
      return reply
        .code(202)
        .send({ status: 'ok', data: { message: 'Enrichment started', limit: ENRICH_LIMIT } });
    } catch (err) {
      logger.warn('Failed to spawn enrichment worker', {
        error: err instanceof Error ? err.message : String(err),
      });
      return reply.code(500).send({ status: 'error', error: 'Failed to start enrichment' });
    }
  });

  /**
   * GET /api/v1/videos/:id/rich-summary - Return cached rich summary (chapters/quotes/tl_dr).
   * CP422 P1: read-only lookup by YouTube video_id (11 chars).
   *   - 200: cached RichSummary JSON
   *   - 404: no passing row (caller may show short summary fallback in UI)
   * Generation itself is gated by RICH_SUMMARY_ENABLED and happens via enrichVideo() /
   * pool gold-tier eager hook. This endpoint does NOT trigger generation.
   */
  fastify.get<{ Params: { id: string } }>(
    '/:id/rich-summary',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params;
      if (!id || id.length > 20) {
        return reply.code(400).send({ status: 'error', error: 'invalid video id' });
      }
      const row = await getPrismaClient().video_rich_summaries.findUnique({
        where: { video_id: id },
      });
      if (!row || row.quality_flag !== 'pass') {
        return reply.code(404).send({
          status: 'error',
          code: 'RICH_SUMMARY_NOT_FOUND',
          message: row
            ? `Rich summary exists but quality_flag=${row.quality_flag}`
            : 'No rich summary available for this video',
        });
      }
      return reply.code(200).send({
        status: 'ok',
        data: {
          videoId: row.video_id,
          oneLiner: row.one_liner,
          structured: row.structured,
          qualityScore: row.quality_score,
          model: row.model,
          updatedAt: row.updated_at.toISOString(),
        },
      });
    }
  );

  fastify.log.info('Video routes registered');

  done();
};

export default videoRoutes;
