/**
 * Rich Notes Routes
 *
 * GET  /api/v1/rich-notes/:cardId
 * PATCH /api/v1/rich-notes/:cardId
 *
 * Backs the Notion-style side editor (Phase 1-4 MVP).
 * Kept in a separate file from videos.ts to minimize merge conflicts with
 * a parallel session working on other video endpoints.
 */
import type { FastifyPluginCallback } from 'fastify';
import { z } from 'zod';
import { RichNoteNotFoundError, getRichNoteService } from '../../modules/notes/rich-note-service';
import {
  tiptapDocSchema,
  findDisallowedTypes,
  type TiptapDoc,
} from '../../modules/notes/tiptap-schema';
import { logger } from '../../utils/logger';

const paramsSchema = z.object({
  cardId: z.string().uuid(),
});

// Origin table of the card id (CP501). Optional ⇒ defaults to user_video_states
// in the service (back-compat with callers that don't pass it).
const noteSourceSchema = z.enum(['user_video_states', 'user_local_cards']).optional();

const getQuerySchema = z.object({
  source: noteSourceSchema,
});

const patchBodySchema = z.object({
  note: tiptapDocSchema,
  sourceTable: noteSourceSchema,
});

export const videoRichNotesRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  const service = () => getRichNoteService();

  fastify.get(
    '/rich-notes/:cardId',
    {
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      if (!request.user || !('userId' in request.user)) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const parseResult = paramsSchema.safeParse(request.params);
      if (!parseResult.success) {
        return reply.code(400).send({
          error: 'Invalid cardId',
          details: parseResult.error.flatten(),
        });
      }
      const { cardId } = parseResult.data;

      // Source is optional; an invalid value falls back to the service default.
      const queryResult = getQuerySchema.safeParse(request.query);
      const source = queryResult.success ? queryResult.data.source : undefined;

      try {
        const view = await service().getRichNote(request.user.userId, cardId, source);
        return reply.code(200).send({
          cardId,
          video: view.video,
          mandalaCell: view.mandalaCell,
          note: view.note,
          isLegacy: view.isLegacy,
          updatedAt: view.updatedAt,
        });
      } catch (err) {
        if (err instanceof RichNoteNotFoundError) {
          return reply.code(404).send({ error: 'Note not found' });
        }
        logger.error('GET /rich-notes/:cardId failed', { err, cardId });
        return reply.code(500).send({ error: 'Internal error' });
      }
    }
  );

  fastify.patch(
    '/rich-notes/:cardId',
    {
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      if (!request.user || !('userId' in request.user)) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const paramsResult = paramsSchema.safeParse(request.params);
      if (!paramsResult.success) {
        return reply.code(400).send({
          error: 'Invalid cardId',
          details: paramsResult.error.flatten(),
        });
      }
      const { cardId } = paramsResult.data;

      const bodyResult = patchBodySchema.safeParse(request.body);
      if (!bodyResult.success) {
        return reply.code(400).send({
          error: 'Invalid Tiptap document',
          details: bodyResult.error.flatten(),
        });
      }
      const doc = bodyResult.data.note as TiptapDoc;

      const disallowed = findDisallowedTypes(doc);
      if (disallowed.length > 0) {
        return reply.code(400).send({
          error: 'Disallowed node or mark type in document',
          details: { disallowed },
        });
      }

      try {
        const result = await service().saveRichNote(
          request.user.userId,
          cardId,
          doc,
          bodyResult.data.sourceTable
        );
        return reply.code(200).send({ updatedAt: result.updatedAt });
      } catch (err) {
        if (err instanceof RichNoteNotFoundError) {
          return reply.code(404).send({ error: 'Note not found' });
        }
        logger.error('PATCH /rich-notes/:cardId failed', { err, cardId });
        return reply.code(500).send({ error: 'Internal error' });
      }
    }
  );

  done();
};
