/**
 * Playlist API Routes
 *
 * REST API endpoints for playlist management
 */

import { FastifyPluginCallback } from 'fastify';
import { getPlaylistManager } from '../../modules/playlist';
import { getSyncEngine } from '../../modules/sync';
import { getAutoSyncScheduler } from '../../modules/scheduler/auto-sync';
import { getPrismaClient } from '../../modules/database/client';
import { getYouTubeClient } from '../../api/client';
import {
  ImportPlaylistRequestSchema,
  ListPlaylistsQuerySchema,
  GetPlaylistParamsSchema,
  SyncPlaylistParamsSchema,
  DeletePlaylistParamsSchema,
  PausePlaylistParamsSchema,
  importPlaylistSchema,
  listPlaylistsSchema,
  getPlaylistSchema,
  syncPlaylistSchema,
  deletePlaylistSchema,
  pausePlaylistSchema,
  resumePlaylistSchema,
  type ImportPlaylistRequest,
  type ListPlaylistsQuery,
  type GetPlaylistParams,
  type SyncPlaylistParams,
  type DeletePlaylistParams,
  type PausePlaylistParams,
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

      // Load OAuth credentials so YouTube API uses OAuth instead of API key
      const db = getPrismaClient();
      const syncSettings = await db.youtube_sync_settings.findUnique({
        where: { user_id: request.user.userId },
      });
      if (syncSettings?.youtube_access_token) {
        getYouTubeClient().setCredentials({
          access_token: syncSettings.youtube_access_token,
          refresh_token: syncSettings.youtube_refresh_token,
          expiry_date: syncSettings.youtube_token_expires_at?.getTime() ?? null,
        });
      }

      const playlist = await getManager().importPlaylist(playlistUrl, request.user.userId);

      const response: PlaylistResponse = {
        id: playlist.id,
        youtubeId: playlist.youtube_playlist_id,
        title: playlist.title ?? '',
        description: playlist.description ?? null,
        channelId: '',
        channelTitle: playlist.channel_title ?? '',
        thumbnailUrl: playlist.thumbnail_url ?? null,
        itemCount: playlist.item_count ?? 0,
        syncStatus: playlist.sync_status ?? 'PENDING',
        isPaused: playlist.is_paused ?? false,
        lastSyncedAt: playlist.last_synced_at?.toISOString() ?? null,
        createdAt: playlist.created_at.toISOString(),
        updatedAt: playlist.updated_at.toISOString(),
      };

      logger.info('Playlist imported successfully', { playlistId: playlist.id });

      // Auto-register sync schedule (6-hour default interval)
      try {
        const DEFAULT_SYNC_CRON = '0 */6 * * *'; // every 6 hours
        await getAutoSyncScheduler().addPlaylist(playlist.id, DEFAULT_SYNC_CRON);
        logger.info('Auto-sync schedule created', { playlistId: playlist.id });
      } catch (err) {
        logger.warn('Failed to create auto-sync schedule (non-fatal)', { error: err });
      }

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

      // Map sortBy to new field names
      let sortBy: 'title' | 'last_synced_at' | 'created_at' | undefined;
      if (validatedQuery.sortBy === 'lastSyncedAt') {
        sortBy = 'last_synced_at';
      } else if (validatedQuery.sortBy === 'createdAt') {
        sortBy = 'created_at';
      } else if (validatedQuery.sortBy === 'title') {
        sortBy = 'title';
      }

      const { playlists, total } = await getManager().listPlaylists({
        userId: request.user.userId,
        filter: validatedQuery.filter,
        sortBy,
        sortOrder: validatedQuery.sortOrder,
        limit: validatedQuery.limit,
        offset: validatedQuery.offset,
      });

      const playlistResponses: PlaylistResponse[] = playlists.map((p) => ({
        id: p.id,
        youtubeId: p.youtube_playlist_id,
        title: p.title ?? '',
        description: p.description ?? null,
        channelId: '',
        channelTitle: p.channel_title ?? '',
        thumbnailUrl: p.thumbnail_url ?? null,
        itemCount: p.item_count ?? 0,
        syncStatus: p.sync_status ?? 'PENDING',
        isPaused: p.is_paused ?? false,
        lastSyncedAt: p.last_synced_at?.toISOString() ?? null,
        createdAt: p.created_at.toISOString(),
        updatedAt: p.updated_at.toISOString(),
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

      const playlist = await getManager().getPlaylistWithItems(id, request.user.userId);

      const response: PlaylistWithItemsResponse = {
        id: playlist.id,
        youtubeId: playlist.youtube_playlist_id,
        title: playlist.title ?? '',
        description: playlist.description ?? null,
        channelId: '',
        channelTitle: playlist.channel_title ?? '',
        thumbnailUrl: playlist.thumbnail_url ?? null,
        itemCount: playlist.item_count ?? 0,
        syncStatus: playlist.sync_status ?? 'PENDING',
        isPaused: playlist.is_paused ?? false,
        lastSyncedAt: playlist.last_synced_at?.toISOString() ?? null,
        createdAt: playlist.created_at.toISOString(),
        updatedAt: playlist.updated_at.toISOString(),
        items: playlist.youtube_playlist_items.map((item) => ({
          id: item.id,
          position: item.position,
          addedAt: item.added_at.toISOString(),
          video: {
            id: item.youtube_videos.id,
            youtubeId: item.youtube_videos.youtube_video_id,
            title: item.youtube_videos.title,
            description: item.youtube_videos.description ?? null,
            channelTitle: item.youtube_videos.channel_title ?? '',
            duration: item.youtube_videos.duration_seconds ?? 0,
            thumbnailUrls: item.youtube_videos.thumbnail_url ?? '',
            viewCount: item.youtube_videos.view_count ? Number(item.youtube_videos.view_count) : 0,
            publishedAt: item.youtube_videos.published_at
              ? item.youtube_videos.published_at.toISOString()
              : item.youtube_videos.created_at.toISOString(),
          },
        })),
      };

      return reply.code(200).send({ playlist: response });
    }
  );

  /**
   * POST /api/v1/playlists/sync-all - Sync every playlist owned by the
   * authenticated user. Sequential execution (respects per-user write
   * rate limit). Failures per playlist are captured in the result row
   * and do NOT abort the remaining syncs.
   *
   * Response shape matches the FE contract in
   * `frontend/src/features/youtube-sync/model/useYouTubeSync.ts:useSyncAllPlaylists`
   * — `data.results: Array<{ playlistId, status, itemsAdded }>`, where
   * `status ∈ { 'completed', 'failed' }`.
   */
  fastify.post<{
    Reply: {
      results: Array<{
        playlistId: string;
        status: 'completed' | 'failed';
        itemsAdded: number;
        error?: string;
      }>;
    };
  }>('/sync-all', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    if (!request.user || !('userId' in request.user)) {
      throw new Error('Unauthorized');
    }
    const userId = request.user.userId;

    const { playlists } = await getManager().listPlaylists({ userId });

    logger.info('Syncing all playlists for user', {
      userId,
      count: playlists.length,
    });

    const results: Array<{
      playlistId: string;
      status: 'completed' | 'failed';
      itemsAdded: number;
      error?: string;
    }> = [];

    for (const playlist of playlists) {
      try {
        const result = await getSync().syncPlaylist(playlist.id);
        results.push({
          playlistId: playlist.id,
          status: 'completed',
          itemsAdded: result.itemsAdded,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn('Playlist sync failed during sync-all', {
          playlistId: playlist.id,
          error: message,
        });
        results.push({
          playlistId: playlist.id,
          status: 'failed',
          itemsAdded: 0,
          error: message,
        });
      }
    }

    return reply.code(200).send({ results });
  });

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

      // Verify ownership before syncing
      await getManager().getPlaylist(id, request.user.userId);

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

      try {
        // Verify ownership before deleting
        await getManager().getPlaylist(id, request.user.userId);

        await getManager().deletePlaylist(id);

        logger.info('Playlist deleted successfully', { playlistId: id });

        return reply.code(200).send({ message: 'Playlist deleted successfully' });
      } catch (error) {
        logger.error('Failed to delete playlist', {
          playlistId: id,
          userId: request.user.userId,
          error: error instanceof Error ? error.message : String(error),
        });

        if (error instanceof Error && error.message.includes('not found')) {
          return reply.code(404).send({ message: 'Playlist not found' });
        }

        throw error;
      }
    }
  );

  /**
   * PATCH /api/v1/playlists/:id/title - Update playlist title
   */
  fastify.patch<{
    Params: PausePlaylistParams;
    Body: { title?: string };
    Reply: { status: string };
  }>(
    '/:id/title',
    {
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      if (!request.user || !('userId' in request.user)) {
        throw new Error('Unauthorized');
      }

      const { id } = PausePlaylistParamsSchema.parse(request.params);
      const { title } = request.body || {};

      // Verify ownership
      await getManager().getPlaylist(id, request.user.userId);

      const prisma = getPrismaClient();
      await prisma.youtube_playlists.update({
        where: { id },
        data: {
          ...(title !== undefined && { title }),
          updated_at: new Date(),
        },
      });

      logger.info('Playlist updated', { playlistId: id, userId: request.user.userId });

      return reply.code(200).send({ status: 'ok' });
    }
  );

  /**
   * PATCH /api/v1/playlists/:id/pause - Pause playlist
   */
  fastify.patch<{ Params: PausePlaylistParams; Reply: { status: string; isPaused: boolean } }>(
    '/:id/pause',
    {
      schema: pausePlaylistSchema,
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      if (!request.user || !('userId' in request.user)) {
        throw new Error('Unauthorized');
      }

      const { id } = PausePlaylistParamsSchema.parse(request.params);

      // Verify ownership
      await getManager().getPlaylist(id, request.user.userId);

      const prisma = getPrismaClient();
      await prisma.youtube_playlists.update({
        where: { id },
        data: { is_paused: true, updated_at: new Date() },
      });

      logger.info('Playlist paused', { playlistId: id, userId: request.user.userId });

      return reply.code(200).send({ status: 'ok', isPaused: true });
    }
  );

  /**
   * PATCH /api/v1/playlists/:id/resume - Resume playlist
   */
  fastify.patch<{ Params: PausePlaylistParams; Reply: { status: string; isPaused: boolean } }>(
    '/:id/resume',
    {
      schema: resumePlaylistSchema,
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      if (!request.user || !('userId' in request.user)) {
        throw new Error('Unauthorized');
      }

      const { id } = PausePlaylistParamsSchema.parse(request.params);

      // Verify ownership
      await getManager().getPlaylist(id, request.user.userId);

      const prisma = getPrismaClient();
      await prisma.youtube_playlists.update({
        where: { id },
        data: { is_paused: false, updated_at: new Date() },
      });

      logger.info('Playlist resumed', { playlistId: id, userId: request.user.userId });

      return reply.code(200).send({ status: 'ok', isPaused: false });
    }
  );

  fastify.log.info('Playlist routes registered');

  done();
};

export default playlistRoutes;
