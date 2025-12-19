/**
 * Sync API Routes
 *
 * REST API endpoints for sync status, history, and scheduling
 */

import { FastifyPluginCallback } from 'fastify';
import { getPlaylistManager } from '../../modules/playlist';
import { getSchedulerManager } from '../../modules/scheduler';
import { getPrismaClient } from '../../modules/database';
import {
  GetSyncStatusParamsSchema,
  GetSyncHistoryQuerySchema,
  GetSyncDetailsParamsSchema,
  CreateScheduleRequestSchema,
  UpdateScheduleParamsSchema,
  UpdateScheduleRequestSchema,
  DeleteScheduleParamsSchema,
  getSyncStatusesSchema,
  getPlaylistSyncStatusSchema,
  getSyncHistorySchema,
  getSyncDetailsSchema,
  getSchedulesSchema,
  createScheduleSchema,
  updateScheduleSchema,
  deleteScheduleSchema,
  type GetSyncStatusParams,
  type GetSyncHistoryQuery,
  type GetSyncDetailsParams,
  type CreateScheduleRequest,
  type UpdateScheduleParams,
  type UpdateScheduleRequest,
  type DeleteScheduleParams,
  type SyncStatusResponse,
  type SyncHistoryResponse,
  type SyncDetailsResponse,
  type ScheduleResponse,
} from '../schemas/sync.schema';
import { logger } from '../../utils/logger';

/**
 * Sync routes plugin
 */
export const syncRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  const playlistManager = getPlaylistManager();
  const schedulerManager = getSchedulerManager();
  const db = getPrismaClient();

  /**
   * GET /api/v1/sync/status - All sync statuses
   */
  fastify.get<{ Reply: { statuses: SyncStatusResponse[] } }>(
    '/status',
    {
      schema: getSyncStatusesSchema,
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      // Type guard for authenticated user
      if (!request.user || !('userId' in request.user)) {
        throw new Error('Unauthorized');
      }

      logger.info('Getting all sync statuses', { userId: request.user.userId });

      const { playlists } = await playlistManager.listPlaylists();

      const statuses: SyncStatusResponse[] = playlists.map((playlist) => ({
        playlistId: playlist.id,
        status: playlist.syncStatus,
        lastSyncedAt: playlist.lastSyncedAt?.toISOString() ?? null,
        itemCount: playlist.itemCount,
        isRunning: playlist.syncStatus === 'IN_PROGRESS',
      }));

      return reply.code(200).send({ statuses });
    }
  );

  /**
   * GET /api/v1/sync/status/:playlistId - Playlist sync status
   */
  fastify.get<{ Params: GetSyncStatusParams; Reply: { status: SyncStatusResponse } }>(
    '/status/:playlistId',
    {
      schema: getPlaylistSyncStatusSchema,
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      // Type guard for authenticated user
      if (!request.user || !('userId' in request.user)) {
        throw new Error('Unauthorized');
      }

      const validatedParams = GetSyncStatusParamsSchema.parse(request.params);
      const { playlistId } = validatedParams;

      logger.info('Getting playlist sync status', { playlistId, userId: request.user.userId });

      const playlist = await playlistManager.getPlaylist(playlistId);

      const status: SyncStatusResponse = {
        playlistId: playlist.id,
        status: playlist.syncStatus,
        lastSyncedAt: playlist.lastSyncedAt?.toISOString() ?? null,
        itemCount: playlist.itemCount,
        isRunning: playlist.syncStatus === 'IN_PROGRESS',
      };

      return reply.code(200).send({ status });
    }
  );

  /**
   * GET /api/v1/sync/history - Sync history
   */
  fastify.get<{ Querystring: GetSyncHistoryQuery; Reply: SyncHistoryResponse }>(
    '/history',
    {
      schema: getSyncHistorySchema,
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      // Type guard for authenticated user
      if (!request.user || !('userId' in request.user)) {
        throw new Error('Unauthorized');
      }

      const validatedQuery = GetSyncHistoryQuerySchema.parse(request.query);

      logger.info('Getting sync history', { userId: request.user.userId, query: validatedQuery });

      // Build where clause
      const where: any = {};
      if (validatedQuery.playlistId) {
        where.playlistId = validatedQuery.playlistId;
      }
      if (validatedQuery.status) {
        where.status = validatedQuery.status;
      }

      // Get total count
      const total = await db.syncHistory.count({ where });

      // Calculate pagination
      const totalPages = Math.ceil(total / validatedQuery.limit);
      const skip = (validatedQuery.page - 1) * validatedQuery.limit;

      // Get history
      const history = await db.syncHistory.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        skip,
        take: validatedQuery.limit,
      });

      const response: SyncHistoryResponse = {
        history: history.map((h) => ({
          id: h.id,
          playlistId: h.playlistId,
          status: h.status,
          startedAt: h.startedAt.toISOString(),
          completedAt: h.completedAt?.toISOString() ?? null,
          duration: h.duration,
          itemsAdded: h.itemsAdded,
          itemsRemoved: h.itemsRemoved,
          itemsReordered: h.itemsReordered,
          quotaUsed: h.quotaUsed,
          errorMessage: h.errorMessage,
        })),
        total,
        page: validatedQuery.page,
        limit: validatedQuery.limit,
        totalPages,
      };

      return reply.code(200).send(response);
    }
  );

  /**
   * GET /api/v1/sync/history/:syncId - Sync details
   */
  fastify.get<{ Params: GetSyncDetailsParams; Reply: { sync: SyncDetailsResponse } | { error: unknown } }>(
    '/history/:syncId',
    {
      schema: getSyncDetailsSchema,
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      // Type guard for authenticated user
      if (!request.user || !('userId' in request.user)) {
        throw new Error('Unauthorized');
      }

      const validatedParams = GetSyncDetailsParamsSchema.parse(request.params);
      const { syncId } = validatedParams;

      logger.info('Getting sync details', { syncId, userId: request.user.userId });

      const syncHistory = await db.syncHistory.findUnique({
        where: { id: syncId },
        include: {
          playlist: true,
        },
      });

      if (!syncHistory) {
        return reply.code(404).send({
          error: {
            code: 'RESOURCE_NOT_FOUND',
            message: 'Sync history not found',
            timestamp: new Date().toISOString(),
            path: request.url,
          },
        });
      }

      const response: SyncDetailsResponse = {
        id: syncHistory.id,
        playlistId: syncHistory.playlistId,
        playlistTitle: syncHistory.playlist.title,
        status: syncHistory.status,
        startedAt: syncHistory.startedAt.toISOString(),
        completedAt: syncHistory.completedAt?.toISOString() ?? null,
        duration: syncHistory.duration,
        itemsAdded: syncHistory.itemsAdded,
        itemsRemoved: syncHistory.itemsRemoved,
        itemsReordered: syncHistory.itemsReordered,
        quotaUsed: syncHistory.quotaUsed,
        errorMessage: syncHistory.errorMessage,
      };

      return reply.code(200).send({ sync: response });
    }
  );

  /**
   * GET /api/v1/sync/schedule - List schedules
   */
  fastify.get<{ Reply: { schedules: ScheduleResponse[] } }>(
    '/schedule',
    {
      schema: getSchedulesSchema,
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      // Type guard for authenticated user
      if (!request.user || !('userId' in request.user)) {
        throw new Error('Unauthorized');
      }

      logger.info('Listing schedules', { userId: request.user.userId });

      const schedules = await schedulerManager.listSchedules();

      const response: ScheduleResponse[] = schedules.map((s) => ({
        id: s.id,
        playlistId: s.playlistId,
        interval: s.interval,
        enabled: s.enabled,
        lastRun: s.lastRun?.toISOString() ?? null,
        nextRun: s.nextRun.toISOString(),
        retryCount: s.retryCount,
        maxRetries: s.maxRetries,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
      }));

      return reply.code(200).send({ schedules: response });
    }
  );

  /**
   * POST /api/v1/sync/schedule - Create schedule
   */
  fastify.post<{ Body: CreateScheduleRequest; Reply: { schedule: ScheduleResponse } }>(
    '/schedule',
    {
      schema: createScheduleSchema,
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      // Type guard for authenticated user
      if (!request.user || !('userId' in request.user)) {
        throw new Error('Unauthorized');
      }

      const validatedData = CreateScheduleRequestSchema.parse(request.body);

      logger.info('Creating schedule', {
        playlistId: validatedData.playlistId,
        userId: request.user.userId,
      });

      // Check if playlist exists
      await playlistManager.getPlaylist(validatedData.playlistId);

      // Create schedule
      const schedule = await schedulerManager.createSchedule({
        playlistId: validatedData.playlistId,
        interval: validatedData.interval,
        enabled: validatedData.enabled,
      });

      const response: ScheduleResponse = {
        id: schedule.id,
        playlistId: schedule.playlistId,
        interval: schedule.interval,
        enabled: schedule.enabled,
        lastRun: schedule.lastRun?.toISOString() ?? null,
        nextRun: schedule.nextRun.toISOString(),
        retryCount: schedule.retryCount,
        maxRetries: schedule.maxRetries,
        createdAt: schedule.createdAt.toISOString(),
        updatedAt: schedule.updatedAt.toISOString(),
      };

      logger.info('Schedule created successfully', { scheduleId: schedule.id });

      return reply.code(200).send({ schedule: response });
    }
  );

  /**
   * PATCH /api/v1/sync/schedule/:id - Update schedule
   */
  fastify.patch<{ Params: UpdateScheduleParams; Body: UpdateScheduleRequest; Reply: { schedule: ScheduleResponse } }>(
    '/schedule/:id',
    {
      schema: updateScheduleSchema,
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      // Type guard for authenticated user
      if (!request.user || !('userId' in request.user)) {
        throw new Error('Unauthorized');
      }

      const validatedParams = UpdateScheduleParamsSchema.parse(request.params);
      const validatedData = UpdateScheduleRequestSchema.parse(request.body);
      const { id } = validatedParams;

      logger.info('Updating schedule', { scheduleId: id, userId: request.user.userId });

      // Update schedule (id is playlistId in this context)
      const schedule = await schedulerManager.updateSchedule(id, {
        interval: validatedData.interval,
        enabled: validatedData.enabled,
      });

      const response: ScheduleResponse = {
        id: schedule.id,
        playlistId: schedule.playlistId,
        interval: schedule.interval,
        enabled: schedule.enabled,
        lastRun: schedule.lastRun?.toISOString() ?? null,
        nextRun: schedule.nextRun.toISOString(),
        retryCount: schedule.retryCount,
        maxRetries: schedule.maxRetries,
        createdAt: schedule.createdAt.toISOString(),
        updatedAt: schedule.updatedAt.toISOString(),
      };

      logger.info('Schedule updated successfully', { scheduleId: id });

      return reply.code(200).send({ schedule: response });
    }
  );

  /**
   * DELETE /api/v1/sync/schedule/:id - Delete schedule
   */
  fastify.delete<{ Params: DeleteScheduleParams; Reply: { message: string } }>(
    '/schedule/:id',
    {
      schema: deleteScheduleSchema,
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      // Type guard for authenticated user
      if (!request.user || !('userId' in request.user)) {
        throw new Error('Unauthorized');
      }

      const validatedParams = DeleteScheduleParamsSchema.parse(request.params);
      const { id } = validatedParams;

      logger.info('Deleting schedule', { scheduleId: id, userId: request.user.userId });

      // Delete schedule (id is playlistId in this context)
      await schedulerManager.deleteSchedule(id);

      logger.info('Schedule deleted successfully', { scheduleId: id });

      return reply.code(200).send({ message: 'Schedule deleted successfully' });
    }
  );

  fastify.log.info('Sync routes registered');

  done();
};

export default syncRoutes;
