/**
 * Note Documents API — CP445 (2026-05-08)
 *
 * Per-mandala TipTap JSON store for the Obsidian-style note mode.
 * One row per (user_id, mandala_id). Drives the centerViewMode='note'
 * editor in `frontend/src/pages/learning/ui/CenterPanel.tsx`.
 *
 * Endpoints:
 *   GET  /:mandalaId        — fetch latest doc for current user (404 → null)
 *   POST /                  — first-create with original_json + content_json
 *   PUT  /:id               — auto-save (content_json only; original_json immutable)
 *
 * Auth: fastify.authenticate (JWT). user_id extracted from request.user.userId.
 *
 * CLAUDE.md compliance:
 *   - Plan→Approve→Execute (CP445 user-approved 2026-05-08)
 *   - 0 LLM API calls (no Anthropic / OpenRouter / Gemini)
 *   - 0 secret exposure (DB read via Prisma client)
 *   - Service domain only (no system-domain ontology touch)
 */

import { FastifyPluginCallback } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { getPrismaClient } from '@/modules/database/client';
import { createSuccessResponse, createErrorResponse, ErrorCode } from '../schemas/common.schema';

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const UuidSchema = z.string().uuid();

/** TipTap JSON shape — we don't validate the inner Tiptap node tree (the
 *  editor is the source of truth) but we do require an object root. */
const TiptapDocSchema = z
  .object({
    type: z.literal('doc'),
    content: z.array(z.unknown()).optional(),
  })
  .passthrough();

const CreateBodySchema = z.object({
  mandalaId: UuidSchema,
  content_json: TiptapDocSchema,
  original_json: TiptapDocSchema,
});

const UpdateBodySchema = z.object({
  content_json: TiptapDocSchema,
});

const ParamsByMandalaSchema = z.object({ mandalaId: UuidSchema });
const ParamsByIdSchema = z.object({ id: UuidSchema });

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const noteDocumentsRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  const prisma = getPrismaClient();

  // GET /api/v1/note-documents/:mandalaId — fetch current user's doc for a mandala
  fastify.get('/:mandalaId', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    if (!request.user || !('userId' in request.user)) {
      return reply
        .code(401)
        .send(createErrorResponse(ErrorCode.UNAUTHORIZED, 'Authentication required', request.url));
    }
    const params = ParamsByMandalaSchema.safeParse(request.params);
    if (!params.success) {
      return reply
        .code(400)
        .send(createErrorResponse(ErrorCode.INVALID_INPUT, 'Invalid mandalaId', request.url));
    }
    const userId = request.user.userId;
    const doc = await prisma.note_documents.findUnique({
      where: { user_id_mandala_id: { user_id: userId, mandala_id: params.data.mandalaId } },
    });
    if (!doc) {
      return reply.send(createSuccessResponse({ doc: null }));
    }
    return reply.send(
      createSuccessResponse({
        doc: {
          id: doc.id,
          mandala_id: doc.mandala_id,
          content_json: doc.content_json,
          original_json: doc.original_json,
          created_at: doc.created_at,
          updated_at: doc.updated_at,
        },
      })
    );
  });

  // POST /api/v1/note-documents — first-create (or upsert by user+mandala unique).
  // Caller passes both content_json and original_json (typically equal at create
  // time). Subsequent edits use PUT /:id.
  fastify.post('/', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    if (!request.user || !('userId' in request.user)) {
      return reply
        .code(401)
        .send(createErrorResponse(ErrorCode.UNAUTHORIZED, 'Authentication required', request.url));
    }
    const body = CreateBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply
        .code(400)
        .send(createErrorResponse(ErrorCode.INVALID_INPUT, body.error.message, request.url));
    }
    const userId = request.user.userId;
    // Upsert by unique (user_id, mandala_id) — first call creates, subsequent
    // calls are idempotent (e.g., concurrent first-paint races on different tabs).
    const doc = await prisma.note_documents.upsert({
      where: { user_id_mandala_id: { user_id: userId, mandala_id: body.data.mandalaId } },
      create: {
        user_id: userId,
        mandala_id: body.data.mandalaId,
        content_json: body.data.content_json as Prisma.InputJsonValue,
        original_json: body.data.original_json as Prisma.InputJsonValue,
      },
      update: {
        // Existing row: do NOT overwrite original_json. content_json sync
        // belongs to PUT /:id; this branch only fires on race-create.
        // Keep both fields untouched (no-op update so updated_at also unchanged).
      },
    });
    return reply.code(201).send(
      createSuccessResponse({
        doc: {
          id: doc.id,
          mandala_id: doc.mandala_id,
          content_json: doc.content_json,
          original_json: doc.original_json,
          created_at: doc.created_at,
          updated_at: doc.updated_at,
        },
      })
    );
  });

  // PUT /api/v1/note-documents/:id — auto-save (content_json only).
  // original_json is IMMUTABLE — restore-original is a client-side action that
  // re-fetches original_json and pushes it to content_json via a regular PUT.
  fastify.put('/:id', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    if (!request.user || !('userId' in request.user)) {
      return reply
        .code(401)
        .send(createErrorResponse(ErrorCode.UNAUTHORIZED, 'Authentication required', request.url));
    }
    const params = ParamsByIdSchema.safeParse(request.params);
    if (!params.success) {
      return reply
        .code(400)
        .send(createErrorResponse(ErrorCode.INVALID_INPUT, 'Invalid id', request.url));
    }
    const body = UpdateBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply
        .code(400)
        .send(createErrorResponse(ErrorCode.INVALID_INPUT, body.error.message, request.url));
    }
    const userId = request.user.userId;

    // Ownership check — updateMany scoped to user_id ensures we don't update
    // someone else's doc even if the id leaks.
    const result = await prisma.note_documents.updateMany({
      where: { id: params.data.id, user_id: userId },
      data: { content_json: body.data.content_json as Prisma.InputJsonValue },
    });
    if (result.count === 0) {
      return reply
        .code(404)
        .send(
          createErrorResponse(ErrorCode.RESOURCE_NOT_FOUND, 'Note document not found', request.url)
        );
    }
    const doc = await prisma.note_documents.findUnique({ where: { id: params.data.id } });
    return reply.send(
      createSuccessResponse({
        doc: doc
          ? {
              id: doc.id,
              mandala_id: doc.mandala_id,
              content_json: doc.content_json,
              original_json: doc.original_json,
              created_at: doc.created_at,
              updated_at: doc.updated_at,
            }
          : null,
      })
    );
  });

  done();
};
