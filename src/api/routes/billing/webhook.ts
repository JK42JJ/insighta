/**
 * POST /api/v1/billing/webhook
 *
 * Public endpoint. Authenticated by X-Signature HMAC-SHA256 only.
 * Body parser is overridden to keep the raw Buffer (signature requires byte
 * equality — the default JSON parser destroys this). Encapsulation: this
 * Content-Type parser is registered inside this plugin scope only.
 *
 * Flow:
 *   1. Verify signature against raw body. Failure → 401 + audit log row.
 *   2. Parse JSON. Bad JSON → 400.
 *   3. Pass to handleEvent (idempotent UNIQUE constraint on provider_event_id).
 *   4. Always return 200 to LS unless signature failed (LS retries on 5xx,
 *      which would noisily duplicate events even when our DB is fine).
 *
 * §3 L1 — design doc reference.
 */

import { FastifyInstance, FastifyRequest } from 'fastify';
import { createErrorResponse, createSuccessResponse, ErrorCode } from '../../schemas/common.schema';
import { billingConfig, handleEvent, verifyLemonSqueezySignature } from '@/modules/billing';
import type { LemonSqueezyWebhookEvent } from '@/modules/billing';
import { logger } from '@/utils/logger';

const SIGNATURE_HEADER = 'x-signature';

export async function billingWebhookRoutes(fastify: FastifyInstance): Promise<void> {
  // Route-scoped raw body parser — does NOT leak to sibling routes thanks to
  // Fastify plugin encapsulation.
  fastify.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => {
    // Fastify will attach `req.body` as the Buffer. We re-parse inside the
    // handler so we keep both raw + parsed forms.
    done(null, body);
  });

  fastify.post('/', async (request: FastifyRequest, reply) => {
    if (!billingConfig.enabled) {
      return reply
        .code(503)
        .send(
          createErrorResponse(
            ErrorCode.SERVICE_UNAVAILABLE,
            'billing is not configured',
            request.url
          )
        );
    }

    const rawBody = request.body as Buffer | undefined;
    if (!rawBody || !Buffer.isBuffer(rawBody)) {
      return reply
        .code(400)
        .send(createErrorResponse(ErrorCode.VALIDATION_ERROR, 'missing raw body', request.url));
    }

    const sigHeader = request.headers[SIGNATURE_HEADER];
    const verify = verifyLemonSqueezySignature(rawBody, sigHeader, billingConfig.webhookSecret);

    // Even when signature fails, we try to ledger the event for audit — but
    // only if the body parses (we still don't want to write malformed rows).
    let payload: LemonSqueezyWebhookEvent;
    try {
      payload = JSON.parse(rawBody.toString('utf-8')) as LemonSqueezyWebhookEvent;
    } catch {
      logger.warn('billing.webhook invalid JSON', { sig_ok: verify.ok });
      return reply
        .code(400)
        .send(createErrorResponse(ErrorCode.VALIDATION_ERROR, 'invalid json', request.url));
    }

    if (!verify.ok) {
      logger.warn('billing.webhook signature reject', { reason: verify.reason });
      // Best-effort audit row (no throw bubble). We use a synthetic id
      // when LS did not include data.id — but normally LS does.
      const providerEventId = payload?.data?.id ?? `unsigned-${Date.now()}`;
      const eventName = payload?.meta?.event_name ?? 'unknown';
      await handleEvent({
        providerEventId,
        eventName,
        payload,
        rawPayload: payload,
        signatureOk: false,
      }).catch(() => {
        /* swallow — already logged */
      });
      return reply
        .code(401)
        .send(createErrorResponse(ErrorCode.UNAUTHORIZED, 'invalid signature', request.url));
    }

    const providerEventId = payload?.data?.id;
    const eventName = payload?.meta?.event_name;
    if (!providerEventId || !eventName) {
      return reply
        .code(400)
        .send(
          createErrorResponse(
            ErrorCode.VALIDATION_ERROR,
            'missing data.id or meta.event_name',
            request.url
          )
        );
    }

    const result = await handleEvent({
      providerEventId,
      eventName,
      payload,
      rawPayload: payload,
      signatureOk: true,
    });

    return reply.send(
      createSuccessResponse({
        status: result.status,
        processed: result.processed,
      })
    );
  });
}
