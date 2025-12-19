/**
 * Note API Routes
 *
 * REST API endpoints for note management
 */

import { FastifyPluginCallback } from 'fastify';
import { getNoteManager } from '../../modules/note/manager';
import { getVideoManager } from '../../modules/video';
import {
  GetVideoNotesParamsSchema,
  GetVideoNotesQuerySchema,
  CreateNoteRequestSchema,
  GetNoteParamsSchema,
  UpdateNoteRequestSchema,
  DeleteNoteParamsSchema,
  ExportNotesQuerySchema,
  listVideoNotesSchema,
  createNoteSchema,
  getNoteSchema,
  updateNoteSchema,
  deleteNoteSchema,
  exportNotesSchema,
  type GetVideoNotesParams,
  type GetVideoNotesQuery,
  type CreateNoteRequest,
  type GetNoteParams,
  type UpdateNoteRequest,
  type DeleteNoteParams,
  type ExportNotesQuery,
  type NoteResponse,
  type ListNotesResponse,
  type ExportNotesResponse,
} from '../schemas/note.schema';
import { logger } from '../../utils/logger';
import { createErrorResponse, ErrorCode } from '../schemas/common.schema';

/**
 * Note routes plugin
 *
 * Note: Managers are lazily loaded in each route handler to avoid
 * initializing YouTube API client at plugin registration time.
 */
export const noteRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  // Lazy getters for managers - only initialize when actually needed
  const getNote = () => getNoteManager();
  const getVideo = () => getVideoManager();

  /**
   * GET /api/v1/videos/:id/notes - List notes for video
   */
  fastify.get<{ Params: GetVideoNotesParams; Querystring: GetVideoNotesQuery; Reply: ListNotesResponse }>(
    '/videos/:id/notes',
    {
      schema: listVideoNotesSchema,
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      // Type guard for authenticated user
      if (!request.user || !('userId' in request.user)) {
        throw new Error('Unauthorized');
      }

      const validatedParams = GetVideoNotesParamsSchema.parse(request.params);
      const validatedQuery = GetVideoNotesQuerySchema.parse(request.query);
      const { id } = validatedParams;

      logger.info('Listing notes for video', { videoId: id, userId: request.user.userId, query: validatedQuery });

      // Get video to get YouTube ID
      const video = await getVideo().getVideo(id);

      // Build filters
      const filters: any = {
        videoId: video.youtubeId,
      };

      if (validatedQuery.tags && validatedQuery.tags.length > 0) {
        filters.tags = validatedQuery.tags;
      }

      if (validatedQuery.timestampStart !== undefined || validatedQuery.timestampEnd !== undefined) {
        filters.timestampRange = {
          start: validatedQuery.timestampStart ?? 0,
          end: validatedQuery.timestampEnd ?? Number.MAX_SAFE_INTEGER,
        };
      }

      // Search notes
      const notes = await getNote().searchNotes(filters);

      const noteResponses: NoteResponse[] = notes.map((n) => ({
        id: n.id,
        videoId: n.videoId,
        timestamp: n.timestamp,
        content: n.content,
        tags: n.tags,
        createdAt: n.createdAt.toISOString(),
        updatedAt: n.updatedAt.toISOString(),
      }));

      const response: ListNotesResponse = {
        notes: noteResponses,
        total: noteResponses.length,
      };

      return reply.code(200).send(response);
    }
  );

  /**
   * POST /api/v1/videos/:id/notes - Create note
   */
  fastify.post<{ Params: GetVideoNotesParams; Body: CreateNoteRequest; Reply: { note: NoteResponse } }>(
    '/videos/:id/notes',
    {
      schema: createNoteSchema,
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      // Type guard for authenticated user
      if (!request.user || !('userId' in request.user)) {
        throw new Error('Unauthorized');
      }

      const validatedParams = GetVideoNotesParamsSchema.parse(request.params);
      const validatedBody = CreateNoteRequestSchema.parse(request.body);
      const { id } = validatedParams;

      logger.info('Creating note for video', { videoId: id, userId: request.user.userId });

      // Get video to get YouTube ID
      const video = await getVideo().getVideo(id);

      // Create note
      const result = await getNote().createNote({
        videoId: video.youtubeId,
        timestamp: validatedBody.timestamp,
        content: validatedBody.content,
        tags: validatedBody.tags,
      });

      if (!result.success || !result.note) {
        const error = createErrorResponse(
          ErrorCode.INTERNAL_SERVER_ERROR,
          result.error || 'Failed to create note',
          request.url
        );
        return reply.code(500).send(error as any);
      }

      const response: NoteResponse = {
        id: result.note.id,
        videoId: result.note.videoId,
        timestamp: result.note.timestamp,
        content: result.note.content,
        tags: result.note.tags,
        createdAt: result.note.createdAt.toISOString(),
        updatedAt: result.note.updatedAt.toISOString(),
      };

      logger.info('Note created successfully', { noteId: result.note.id });

      return reply.code(200).send({ note: response });
    }
  );

  /**
   * GET /api/v1/notes/:noteId - Get specific note
   */
  fastify.get<{ Params: GetNoteParams; Reply: { note: NoteResponse } }>(
    '/:noteId',
    {
      schema: getNoteSchema,
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      // Type guard for authenticated user
      if (!request.user || !('userId' in request.user)) {
        throw new Error('Unauthorized');
      }

      const validatedParams = GetNoteParamsSchema.parse(request.params);
      const { noteId } = validatedParams;

      logger.info('Getting note', { noteId, userId: request.user.userId });

      const note = await getNote().getNote(noteId);

      if (!note) {
        const error = createErrorResponse(ErrorCode.RESOURCE_NOT_FOUND, 'Note not found', request.url);
        return reply.code(404).send(error as any);
      }

      const response: NoteResponse = {
        id: note.id,
        videoId: note.videoId,
        timestamp: note.timestamp,
        content: note.content,
        tags: note.tags,
        createdAt: note.createdAt.toISOString(),
        updatedAt: note.updatedAt.toISOString(),
      };

      return reply.code(200).send({ note: response });
    }
  );

  /**
   * PATCH /api/v1/notes/:noteId - Update note
   */
  fastify.patch<{ Params: GetNoteParams; Body: UpdateNoteRequest; Reply: { note: NoteResponse } }>(
    '/:noteId',
    {
      schema: updateNoteSchema,
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      // Type guard for authenticated user
      if (!request.user || !('userId' in request.user)) {
        throw new Error('Unauthorized');
      }

      const validatedParams = GetNoteParamsSchema.parse(request.params);
      const validatedBody = UpdateNoteRequestSchema.parse(request.body);
      const { noteId } = validatedParams;

      logger.info('Updating note', { noteId, userId: request.user.userId });

      const result = await getNote().updateNote(noteId, validatedBody);

      if (!result.success || !result.note) {
        const error = createErrorResponse(
          ErrorCode.RESOURCE_NOT_FOUND,
          result.error || 'Failed to update note',
          request.url
        );
        return reply.code(404).send(error as any);
      }

      const response: NoteResponse = {
        id: result.note.id,
        videoId: result.note.videoId,
        timestamp: result.note.timestamp,
        content: result.note.content,
        tags: result.note.tags,
        createdAt: result.note.createdAt.toISOString(),
        updatedAt: result.note.updatedAt.toISOString(),
      };

      logger.info('Note updated successfully', { noteId });

      return reply.code(200).send({ note: response });
    }
  );

  /**
   * DELETE /api/v1/notes/:noteId - Delete note
   */
  fastify.delete<{ Params: DeleteNoteParams; Reply: { message: string } }>(
    '/:noteId',
    {
      schema: deleteNoteSchema,
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      // Type guard for authenticated user
      if (!request.user || !('userId' in request.user)) {
        throw new Error('Unauthorized');
      }

      const validatedParams = DeleteNoteParamsSchema.parse(request.params);
      const { noteId } = validatedParams;

      logger.info('Deleting note', { noteId, userId: request.user.userId });

      const result = await getNote().deleteNote(noteId);

      if (!result.success) {
        const error = createErrorResponse(
          ErrorCode.RESOURCE_NOT_FOUND,
          result.error || 'Failed to delete note',
          request.url
        );
        return reply.code(404).send(error as any);
      }

      logger.info('Note deleted successfully', { noteId });

      return reply.code(200).send({ message: 'Note deleted successfully' });
    }
  );

  /**
   * GET /api/v1/notes/export - Export notes
   */
  fastify.get<{ Querystring: ExportNotesQuery; Reply: ExportNotesResponse }>(
    '/export',
    {
      schema: exportNotesSchema,
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      // Type guard for authenticated user
      if (!request.user || !('userId' in request.user)) {
        throw new Error('Unauthorized');
      }

      const validatedQuery = ExportNotesQuerySchema.parse(request.query);

      logger.info('Exporting notes', { userId: request.user.userId, query: validatedQuery });

      // Build filters
      const filters: any = {};

      if (validatedQuery.videoId) {
        filters.videoId = validatedQuery.videoId;
      }

      if (validatedQuery.tags && validatedQuery.tags.length > 0) {
        filters.tags = validatedQuery.tags;
      }

      // Export notes
      const result = await getNote().exportNotes(filters, validatedQuery.format);

      if (!result.success || !result.content) {
        const error = createErrorResponse(
          ErrorCode.RESOURCE_NOT_FOUND,
          result.error || 'No notes found to export',
          request.url
        );
        return reply.code(404).send(error as any);
      }

      const response: ExportNotesResponse = {
        content: result.content,
        format: result.format,
      };

      logger.info('Notes exported successfully', { format: result.format });

      return reply.code(200).send(response);
    }
  );

  fastify.log.info('Note routes registered');

  done();
};

export default noteRoutes;
