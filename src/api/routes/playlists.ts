/**
 * Playlist API Routes
 *
 * REST API endpoints for playlist management
 */

import { FastifyPluginCallback } from 'fastify';
import { getPlaylistManager } from '../../modules/playlist';
import { getSyncEngine } from '../../modules/sync';
import {
  ImportPlaylistRequestSchema,
  ListPlaylistsQuerySchema,
  GetPlaylistParamsSchema,
  SyncPlaylistParamsSchema,
  DeletePlaylistParamsSchema,
  importPlaylistSchema,
  listPlaylistsSchema,
  getPlaylistSchema,
  syncPlaylistSchema,
  deletePlaylistSchema,
  type ImportPlaylistRequest,
  type ListPlaylistsQuery,
  type GetPlaylistParams,
  type SyncPlaylistParams,
  type DeletePlaylistParams,
  type PlaylistResponse,
  type ListPlaylistsResponse,
  type PlaylistWithItemsResponse,
  type SyncResultResponse,
} from '../schemas/playlist.schema';
import { logger } from '../../utils/logger';

/**
 * Playlist routes plugin
 *
 * Note: PlaylistManager and SyncEngine are lazily loaded in each route handler
 * to avoid initializing YouTube API client at plugin registration time.
 * This is required for serverless environments where credentials may not be available
 * until the actual request is made.
 */
export const playlistRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  // Lazy getters for managers - only initialize when actually needed
  const getManager = () => getPlaylistManager();
  const getSync = () => getSyncEngine();

  /**
   * POST /api/v1/playlists/import - Import playlist
   */
  fastify.post<{ Body: ImportPlaylistRequest; Reply: { playlist: PlaylistResponse } }>(
    '/import',
    {
      schema: importPlaylistSchema,
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      // Type guard for authenticated user
      if (!request.user || !('userId' in request.user)) {
        throw new Error('Unauthorized');
      }

      const validatedData = ImportPlaylistRequestSchema.parse(request.body);
      const { playlistUrl } = validatedData;

      logger.info('Importing playlist', { playlistUrl, userId: request.user.userId });

      const playlist = await getManager().importPlaylist(playlistUrl);

      const response: PlaylistResponse = {
        id: playlist.id,
        youtubeId: playlist.youtubeId,
        title: playlist.title,
        description: playlist.description,
        channelId: playlist.channelId,
        channelTitle: playlist.channelTitle,
        thumbnailUrl: playlist.thumbnailUrl,
        itemCount: playlist.itemCount,
        syncStatus: playlist.syncStatus,
        lastSyncedAt: playlist.lastSyncedAt?.toISOString() ?? null,
        createdAt: playlist.createdAt.toISOString(),
        updatedAt: playlist.updatedAt.toISOString(),
      };

      logger.info('Playlist imported successfully', { playlistId: playlist.id });

      return reply.code(200).send({ playlist: response });
    }
  );

  /**
   * GET /api/v1/playlists - List playlists
   */
  fastify.get<{ Querystring: ListPlaylistsQuery; Reply: ListPlaylistsResponse }>(
    '/',
    {
      schema: listPlaylistsSchema,
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      // Type guard for authenticated user
      if (!request.user || !('userId' in request.user)) {
        throw new Error('Unauthorized');
      }

      const validatedQuery = ListPlaylistsQuerySchema.parse(request.query);

      logger.info('Listing playlists', { userId: request.user.userId, query: validatedQuery });

      const { playlists, total } = await getManager().listPlaylists({
        filter: validatedQuery.filter,
        sortBy: validatedQuery.sortBy,
        sortOrder: validatedQuery.sortOrder,
        limit: validatedQuery.limit,
        offset: validatedQuery.offset,
      });

      const playlistResponses: PlaylistResponse[] = playlists.map((p) => ({
        id: p.id,
        youtubeId: p.youtubeId,
        title: p.title,
        description: p.description,
        channelId: p.channelId,
        channelTitle: p.channelTitle,
        thumbnailUrl: p.thumbnailUrl,
        itemCount: p.itemCount,
        syncStatus: p.syncStatus,
        lastSyncedAt: p.lastSyncedAt?.toISOString() ?? null,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      }));

      const response: ListPlaylistsResponse = {
        playlists: playlistResponses,
        total,
        limit: validatedQuery.limit,
        offset: validatedQuery.offset,
      };

      return reply.code(200).send(response);
    }
  );

  /**
   * GET /api/v1/playlists/:id - Get playlist details
   */
  fastify.get<{ Params: GetPlaylistParams; Reply: { playlist: PlaylistWithItemsResponse } }>(
    '/:id',
    {
      schema: getPlaylistSchema,
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      // Type guard for authenticated user
      if (!request.user || !('userId' in request.user)) {
        throw new Error('Unauthorized');
      }

      const validatedParams = GetPlaylistParamsSchema.parse(request.params);
      const { id } = validatedParams;

      logger.info('Getting playlist details', { playlistId: id, userId: request.user.userId });

      const playlist = await getManager().getPlaylistWithItems(id);

      const response: PlaylistWithItemsResponse = {
        id: playlist.id,
        youtubeId: playlist.youtubeId,
        title: playlist.title,
        description: playlist.description,
        channelId: playlist.channelId,
        channelTitle: playlist.channelTitle,
        thumbnailUrl: playlist.thumbnailUrl,
        itemCount: playlist.itemCount,
        syncStatus: playlist.syncStatus,
        lastSyncedAt: playlist.lastSyncedAt?.toISOString() ?? null,
        createdAt: playlist.createdAt.toISOString(),
        updatedAt: playlist.updatedAt.toISOString(),
        items: playlist.items.map((item) => ({
          id: item.id,
          position: item.position,
          addedAt: item.addedAt.toISOString(),
          video: {
            id: item.video.id,
            youtubeId: item.video.youtubeId,
            title: item.video.title,
            description: item.video.description,
            channelTitle: item.video.channelTitle,
            duration: item.video.duration,
            thumbnailUrls: item.video.thumbnailUrls,
            viewCount: item.video.viewCount,
            publishedAt: item.video.publishedAt.toISOString(),
          },
        })),
      };

      return reply.code(200).send({ playlist: response });
    }
  );

  /**
   * POST /api/v1/playlists/:id/sync - Sync playlist
   */
  fastify.post<{ Params: SyncPlaylistParams; Reply: { result: SyncResultResponse } }>(
    '/:id/sync',
    {
      schema: syncPlaylistSchema,
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      // Type guard for authenticated user
      if (!request.user || !('userId' in request.user)) {
        throw new Error('Unauthorized');
      }

      const validatedParams = SyncPlaylistParamsSchema.parse(request.params);
      const { id } = validatedParams;

      logger.info('Syncing playlist', { playlistId: id, userId: request.user.userId });

      const result = await getSync().syncPlaylist(id);

      const response: SyncResultResponse = {
        playlistId: result.playlistId,
        status: result.status,
        itemsAdded: result.itemsAdded,
        itemsRemoved: result.itemsRemoved,
        itemsReordered: result.itemsReordered,
        duration: result.duration,
        quotaUsed: result.quotaUsed,
        error: result.error,
      };

      logger.info('Playlist synced successfully', { playlistId: id, result });

      return reply.code(200).send({ result: response });
    }
  );

  /**
   * DELETE /api/v1/playlists/:id - Delete playlist
   */
  fastify.delete<{ Params: DeletePlaylistParams; Reply: { message: string } }>(
    '/:id',
    {
      schema: deletePlaylistSchema,
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      // Type guard for authenticated user
      if (!request.user || !('userId' in request.user)) {
        throw new Error('Unauthorized');
      }

      const validatedParams = DeletePlaylistParamsSchema.parse(request.params);
      const { id } = validatedParams;

      logger.info('Deleting playlist', { playlistId: id, userId: request.user.userId });

      await getManager().deletePlaylist(id);

      logger.info('Playlist deleted successfully', { playlistId: id });

      return reply.code(200).send({ message: 'Playlist deleted successfully' });
    }
  );

  fastify.log.info('Playlist routes registered');

  done();
};

export default playlistRoutes;
