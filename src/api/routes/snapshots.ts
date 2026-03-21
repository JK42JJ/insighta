/**
 * Card Snapshot API Routes
 *
 * Provides snapshot/rollback functionality for card state changes.
 * Used by bot-write-guard to enable safe bot write operations.
 *
 * Related: #304 (Clawbot snapshot + rollback + approval button)
 */

import { FastifyPluginCallback } from 'fastify';
import { Prisma } from '@prisma/client';
import { getPrismaClient } from '../../modules/database';
import { createErrorResponse, ErrorCode } from '../schemas/common.schema';

const SNAPSHOT_EXPIRY_HOURS = 24;

interface SnapshotCardData {
  card_id: string;
  cell_index: number;
  level_id: string | null;
  mandala_id: string | null;
  sort_order: number | null;
}

export const snapshotRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  /**
   * POST /api/v1/snapshots — Create a snapshot of current card state
   */
  fastify.post(
    '/',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user.userId;
      const { reason, card_ids } = request.body as {
        reason: string;
        card_ids?: string[];
      };

      if (!reason) {
        return reply.code(400).send(
          createErrorResponse(ErrorCode.VALIDATION_ERROR, 'reason is required', request.url)
        );
      }

      const prisma = getPrismaClient();

      // Capture current state of affected cards
      const where: { user_id: string; id?: { in: string[] } } = { user_id: userId };
      if (card_ids && card_ids.length > 0) {
        where.id = { in: card_ids };
      }

      const cards = await prisma.user_local_cards.findMany({
        where,
        select: {
          id: true,
          cell_index: true,
          level_id: true,
          mandala_id: true,
          sort_order: true,
        },
      });

      const snapshotData: SnapshotCardData[] = cards.map((c) => ({
        card_id: c.id,
        cell_index: c.cell_index ?? -1,
        level_id: c.level_id,
        mandala_id: c.mandala_id,
        sort_order: c.sort_order,
      }));

      const snapshot = await prisma.card_snapshots.create({
        data: {
          user_id: userId,
          reason,
          snapshot_data: snapshotData as unknown as Prisma.InputJsonValue,
          status: 'pending',
        },
      });

      return reply.code(201).send({
        status: 'ok',
        data: {
          id: snapshot.id,
          reason: snapshot.reason,
          card_count: snapshotData.length,
          created_at: snapshot.created_at,
        },
      });
    },
  );

  /**
   * POST /api/v1/snapshots/:id/rollback — Restore cards from snapshot
   */
  fastify.post(
    '/:id/rollback',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user.userId;
      const { id } = request.params as { id: string };
      const prisma = getPrismaClient();

      const snapshot = await prisma.card_snapshots.findFirst({
        where: { id, user_id: userId },
      });

      if (!snapshot) {
        return reply.code(404).send(
          createErrorResponse(ErrorCode.RESOURCE_NOT_FOUND, 'Snapshot not found', request.url)
        );
      }

      if (snapshot.status !== 'pending') {
        return reply.code(400).send(
          createErrorResponse(
            ErrorCode.INVALID_INPUT,
            `Snapshot already ${snapshot.status}`,
            request.url
          )
        );
      }

      // Restore each card to its snapshot state
      const cards = snapshot.snapshot_data as unknown as SnapshotCardData[];
      let restored = 0;

      for (const card of cards) {
        try {
          await prisma.user_local_cards.update({
            where: { id: card.card_id },
            data: {
              cell_index: card.cell_index,
              level_id: card.level_id,
              mandala_id: card.mandala_id,
              sort_order: card.sort_order,
            },
          });
          restored++;
        } catch {
          // Card may have been deleted since snapshot — skip
        }
      }

      await prisma.card_snapshots.update({
        where: { id },
        data: { status: 'rolled_back', rolled_back_at: new Date() },
      });

      return reply.send({
        status: 'ok',
        data: {
          id: snapshot.id,
          restored_count: restored,
          total_count: cards.length,
        },
      });
    },
  );

  /**
   * GET /api/v1/snapshots — List pending snapshots
   */
  fastify.get(
    '/',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user.userId;
      const prisma = getPrismaClient();

      const expiryThreshold = new Date(Date.now() - SNAPSHOT_EXPIRY_HOURS * 60 * 60 * 1000);

      const snapshots = await prisma.card_snapshots.findMany({
        where: {
          user_id: userId,
          created_at: { gte: expiryThreshold },
        },
        select: {
          id: true,
          reason: true,
          status: true,
          created_at: true,
          rolled_back_at: true,
        },
        orderBy: { created_at: 'desc' },
        take: 20,
      });

      return reply.send({ status: 'ok', data: snapshots });
    },
  );

  /**
   * DELETE /api/v1/snapshots/:id — Confirm snapshot (discard, mark as confirmed)
   */
  fastify.delete(
    '/:id',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user.userId;
      const { id } = request.params as { id: string };
      const prisma = getPrismaClient();

      const snapshot = await prisma.card_snapshots.findFirst({
        where: { id, user_id: userId },
      });

      if (!snapshot) {
        return reply.code(404).send(
          createErrorResponse(ErrorCode.RESOURCE_NOT_FOUND, 'Snapshot not found', request.url)
        );
      }

      await prisma.card_snapshots.update({
        where: { id },
        data: { status: 'confirmed' },
      });

      return reply.send({ status: 'ok', data: { id, confirmed: true } });
    },
  );

  fastify.log.info('Snapshot routes registered');
  done();
};

export default snapshotRoutes;
