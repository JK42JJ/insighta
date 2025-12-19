/**
 * Video API Routes
 *
 * REST API endpoints for video management
 */

import { FastifyPluginCallback } from 'fastify';
import { getVideoManager } from '../../modules/video';
import { getCaptionExtractor } from '../../modules/caption/extractor';
import { getPrismaClient } from '../../modules/database';
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

/**
 * Video routes plugin
 */
export const videoRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  const videoManager = getVideoManager();
  const captionExtractor = getCaptionExtractor();
  const db = getPrismaClient();

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
        where.playlistItems = {
          some: {
            playlistId: validatedQuery.playlistId,
            removedAt: null,
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

      // Filter by watch status
      if (validatedQuery.status) {
        where.userState = {
          watchStatus: validatedQuery.status,
        };
      }

      // Filter by tags (client-side since tags are JSON)
      // This will be handled after fetching

      // Build order by
      const orderBy: any = {};
      if (validatedQuery.sortBy) {
        orderBy[validatedQuery.sortBy] = validatedQuery.sortOrder;
      } else {
        orderBy.publishedAt = 'desc';
      }

      // Calculate pagination
      const skip = (validatedQuery.page - 1) * validatedQuery.limit;

      // Fetch videos
      const [videos, total] = await Promise.all([
        db.video.findMany({
          where,
          orderBy,
          skip,
          take: validatedQuery.limit,
        }),
        db.video.count({ where }),
      ]);

      // Filter by tags if specified (client-side)
      let filteredVideos = videos;
      if (validatedQuery.tags && validatedQuery.tags.length > 0) {
        filteredVideos = videos.filter((video) => {
          if (!video.tags) return false;
          const videoTags = JSON.parse(video.tags);
          return validatedQuery.tags!.some((tag) => videoTags.includes(tag));
        });
      }

      const videoResponses: VideoResponse[] = filteredVideos.map((v) => ({
        id: v.id,
        youtubeId: v.youtubeId,
        title: v.title,
        description: v.description,
        channelId: v.channelId,
        channelTitle: v.channelTitle,
        duration: v.duration,
        thumbnailUrls: v.thumbnailUrls,
        viewCount: v.viewCount,
        likeCount: v.likeCount,
        commentCount: v.commentCount,
        publishedAt: v.publishedAt.toISOString(),
        tags: v.tags,
        categoryId: v.categoryId,
        language: v.language,
        createdAt: v.createdAt.toISOString(),
        updatedAt: v.updatedAt.toISOString(),
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

      const videoWithState = await videoManager.getVideoWithState(id);

      const response: VideoWithStateResponse = {
        id: videoWithState.id,
        youtubeId: videoWithState.youtubeId,
        title: videoWithState.title,
        description: videoWithState.description,
        channelId: videoWithState.channelId,
        channelTitle: videoWithState.channelTitle,
        duration: videoWithState.duration,
        thumbnailUrls: videoWithState.thumbnailUrls,
        viewCount: videoWithState.viewCount,
        likeCount: videoWithState.likeCount,
        commentCount: videoWithState.commentCount,
        publishedAt: videoWithState.publishedAt.toISOString(),
        tags: videoWithState.tags,
        categoryId: videoWithState.categoryId,
        language: videoWithState.language,
        createdAt: videoWithState.createdAt.toISOString(),
        updatedAt: videoWithState.updatedAt.toISOString(),
        userState: videoWithState.userState
          ? {
              watchStatus: videoWithState.userState.watchStatus,
              lastPosition: videoWithState.userState.lastPosition,
              watchCount: videoWithState.userState.watchCount,
              notes: videoWithState.userState.notes,
              summary: videoWithState.userState.summary,
              tags: videoWithState.userState.tags,
              rating: videoWithState.userState.rating,
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
  fastify.get<{ Params: GetVideoParams; Querystring: GetCaptionsQuery; Reply: { caption: CaptionResponse } }>(
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
      const video = await videoManager.getVideo(id);

      // Extract captions (will use cached if available)
      const result = await captionExtractor.extractCaptions(video.youtubeId, language);

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

      logger.info('Getting available caption languages', { videoId: id, userId: request.user.userId });

      // Get video to get YouTube ID
      const video = await videoManager.getVideo(id);

      // Get available languages
      const result = await captionExtractor.getAvailableLanguages(video.youtubeId);

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
      const videoWithState = await videoManager.getVideoWithState(id);

      // Check if summary exists
      if (!videoWithState.userState || !videoWithState.userState.summary) {
        const error = createErrorResponse(
          ErrorCode.RESOURCE_NOT_FOUND,
          'Summary not found for this video. Generate it first using POST /videos/:id/summary',
          request.url
        );
        return reply.code(404).send(error as any);
      }

      const response: SummaryResponse = {
        videoId: videoWithState.youtubeId,
        summary: videoWithState.userState.summary,
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
  fastify.post<{ Params: GetVideoParams; Body: GenerateSummaryRequest; Reply: { summary: SummaryResponse } }>(
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

      logger.info('Generating summary', { videoId: id, level, language, userId: request.user.userId });

      // Get video
      const video = await videoManager.getVideo(id);

      // Extract captions first
      const captionResult = await captionExtractor.extractCaptions(video.youtubeId, language);

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
      let summaryText: string;

      switch (level) {
        case 'brief':
          summaryText = words.slice(0, 100).join(' ') + '...';
          break;
        case 'detailed':
          summaryText = words.slice(0, 300).join(' ') + '...';
          break;
        case 'comprehensive':
          summaryText = words.slice(0, 500).join(' ') + '...';
          break;
        default:
          summaryText = words.slice(0, 100).join(' ') + '...';
      }

      // Save summary to user state
      await videoManager.addSummary(id, summaryText);

      const response: SummaryResponse = {
        videoId: video.youtubeId,
        summary: summaryText,
        level,
        language,
        generatedAt: new Date().toISOString(),
      };

      logger.info('Summary generated successfully', { videoId: id });

      return reply.code(200).send({ summary: response });
    }
  );

  fastify.log.info('Video routes registered');

  done();
};

export default videoRoutes;
