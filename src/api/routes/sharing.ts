/**
 * Mandala Sharing Routes
 *
 * REST API endpoints for creating share links, viewing shared mandalas, and cloning.
 */

import { FastifyPluginCallback } from 'fastify';
import {
  createShareLink,
  getSharedMandala,
  cloneSharedMandala,
  listShareLinks,
  deleteShareLink,
} from '../../modules/sharing/manager';

export const sharingRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  /**
   * POST /api/v1/sharing/create - Create a share link for a mandala
   */
  fastify.post<{
    Body: { mandalaId: string; mode?: 'view' | 'view_cards' | 'clone'; expiresInDays?: number };
  }>('/create', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    if (!request.user || !('userId' in request.user)) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const { mandalaId, mode, expiresInDays } = request.body;
    if (!mandalaId) {
      return reply.code(400).send({
        status: 'error',
        code: 'MISSING_MANDALA_ID',
        message: 'mandalaId is required',
      });
    }

    try {
      const share = await createShareLink(
        mandalaId,
        request.user.userId,
        mode || 'view',
        expiresInDays
      );
      return reply.code(201).send({ status: 'ok', data: share });
    } catch (err: any) {
      if (err.message === 'MANDALA_NOT_FOUND') {
        return reply.code(404).send({
          status: 'error',
          code: 'MANDALA_NOT_FOUND',
          message: 'Mandala not found or not owned by you',
        });
      }
      throw err;
    }
  });

  /**
   * GET /api/v1/sharing/:code - View a shared mandala (public, no auth required)
   */
  fastify.get<{ Params: { code: string } }>('/:code', async (request, reply) => {
    const result = await getSharedMandala(request.params.code);
    if (!result) {
      return reply.code(404).send({
        status: 'error',
        code: 'SHARE_NOT_FOUND',
        message: 'Share link not found or expired',
      });
    }

    // In 'view' mode, hide card count
    if (result.share.mode === 'view') {
      return reply.send({
        status: 'ok',
        data: {
          share: result.share,
          mandala: {
            title: result.mandala.title,
            levels: result.mandala.levels,
          },
        },
      });
    }

    return reply.send({ status: 'ok', data: result });
  });

  /**
   * POST /api/v1/sharing/:code/clone - Clone a shared mandala to my account
   */
  fastify.post<{ Params: { code: string } }>(
    '/:code/clone',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      if (!request.user || !('userId' in request.user)) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      try {
        const result = await cloneSharedMandala(request.params.code, request.user.userId);
        return reply.code(201).send({ status: 'ok', data: result });
      } catch (err: any) {
        if (err.message === 'SHARE_NOT_FOUND') {
          return reply.code(404).send({
            status: 'error',
            code: 'SHARE_NOT_FOUND',
            message: 'Share link not found or expired',
          });
        }
        if (err.message === 'CLONE_NOT_ALLOWED') {
          return reply.code(403).send({
            status: 'error',
            code: 'CLONE_NOT_ALLOWED',
            message: 'This share link does not allow cloning',
          });
        }
        throw err;
      }
    }
  );

  /**
   * GET /api/v1/sharing/mandala/:mandalaId - List share links for a mandala
   */
  fastify.get<{ Params: { mandalaId: string } }>(
    '/mandala/:mandalaId',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      if (!request.user || !('userId' in request.user)) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      try {
        const shares = await listShareLinks(request.params.mandalaId, request.user.userId);
        return reply.send({ status: 'ok', data: shares });
      } catch (err: any) {
        if (err.message === 'MANDALA_NOT_FOUND') {
          return reply.code(404).send({
            status: 'error',
            code: 'MANDALA_NOT_FOUND',
            message: 'Mandala not found',
          });
        }
        throw err;
      }
    }
  );

  /**
   * DELETE /api/v1/sharing/:shareId - Delete a share link
   */
  fastify.delete<{ Params: { shareId: string } }>(
    '/:shareId',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      if (!request.user || !('userId' in request.user)) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      try {
        await deleteShareLink(request.params.shareId, request.user.userId);
        return reply.send({ status: 'ok' });
      } catch (err: any) {
        if (err.message === 'SHARE_NOT_FOUND') {
          return reply.code(404).send({
            status: 'error',
            code: 'SHARE_NOT_FOUND',
            message: 'Share link not found',
          });
        }
        throw err;
      }
    }
  );

  done();
};

export default sharingRoutes;
