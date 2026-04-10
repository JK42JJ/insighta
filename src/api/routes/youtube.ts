/**
 * YouTube API Routes
 *
 * REST API endpoints for fetching user's YouTube subscriptions and playlists.
 * Requires YouTube OAuth connection (youtube_sync_settings).
 */

import { FastifyPluginCallback } from 'fastify';
import {
  getUserSubscriptions,
  getUserPlaylists,
  clearYouTubeCache,
} from '../../modules/youtube/api';
import { loadYouTubeOAuth } from '../plugins/youtube-oauth';

export const youtubeRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  // Load YouTube OAuth credentials for all routes in this plugin
  fastify.addHook('preHandler', loadYouTubeOAuth);
  /**
   * GET /api/v1/youtube/subscriptions - Get user's YouTube subscriptions
   * Query: ?pageToken=xxx (optional, for pagination)
   */
  fastify.get<{ Querystring: { pageToken?: string } }>(
    '/subscriptions',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      if (!request.user || !('userId' in request.user)) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      try {
        const result = await getUserSubscriptions(request.user.userId, request.query.pageToken);
        return reply.send({
          status: 'ok',
          data: result.items,
          pagination: {
            nextPageToken: result.nextPageToken,
            totalResults: result.totalResults,
          },
        });
      } catch (err: any) {
        if (err.message === 'YOUTUBE_NOT_CONNECTED') {
          return reply.code(400).send({
            status: 'error',
            code: 'YOUTUBE_NOT_CONNECTED',
            message:
              'YouTube account not connected or token expired. Please reconnect via Settings.',
          });
        }
        if (err.message.startsWith('YOUTUBE_API_ERROR')) {
          return reply.code(502).send({
            status: 'error',
            code: 'YOUTUBE_API_ERROR',
            message: err.message,
          });
        }
        throw err;
      }
    }
  );

  /**
   * GET /api/v1/youtube/playlists - Get user's YouTube playlists
   * Query: ?pageToken=xxx (optional, for pagination)
   */
  fastify.get<{ Querystring: { pageToken?: string } }>(
    '/playlists',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      if (!request.user || !('userId' in request.user)) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      try {
        const result = await getUserPlaylists(request.user.userId, request.query.pageToken);
        return reply.send({
          status: 'ok',
          data: result.items,
          pagination: {
            nextPageToken: result.nextPageToken,
            totalResults: result.totalResults,
          },
        });
      } catch (err: any) {
        if (err.message === 'YOUTUBE_NOT_CONNECTED') {
          return reply.code(400).send({
            status: 'error',
            code: 'YOUTUBE_NOT_CONNECTED',
            message:
              'YouTube account not connected or token expired. Please reconnect via Settings.',
          });
        }
        if (err.message.startsWith('YOUTUBE_API_ERROR')) {
          return reply.code(502).send({
            status: 'error',
            code: 'YOUTUBE_API_ERROR',
            message: err.message,
          });
        }
        throw err;
      }
    }
  );

  /**
   * POST /api/v1/youtube/cache-clear — Invalidate YouTube API cache for user
   * Called by FE after OAuth disconnect/reconnect to ensure fresh data.
   */
  fastify.post('/cache-clear', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    if (!request.user || !('userId' in request.user)) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
    clearYouTubeCache(request.user.userId);
    return reply.send({ status: 'ok' });
  });

  done();
};

export default youtubeRoutes;
