import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { db } from '../../../modules/database/client';
import { createErrorResponse, createSuccessResponse, ErrorCode } from '../../schemas/common.schema';

const STRIPE_WEBHOOK_SECRET = process.env['STRIPE_WEBHOOK_SECRET'] ?? '';
const STRIPE_SECRET_KEY = process.env['STRIPE_SECRET_KEY'] ?? '';

const MAX_TRANSACTION_LIST_SIZE = 100;

const CheckoutSchema = z.object({
  priceId: z.string().min(1),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
});

export async function adminPaymentRoutes(fastify: FastifyInstance) {
  const adminAuth = { onRequest: [fastify.authenticate, fastify.authenticateAdmin] };

  // GET /api/v1/admin/payments/transactions — List transactions (admin)
  fastify.get('/transactions', adminAuth, async (_request: FastifyRequest, reply: FastifyReply) => {
    const transactions = await db.$queryRaw<Array<Record<string, unknown>>>`
      SELECT
        pt.*,
        u.email as user_email
      FROM public.payment_transactions pt
      LEFT JOIN auth.users u ON u.id = pt.user_id
      ORDER BY pt.created_at DESC
      LIMIT ${MAX_TRANSACTION_LIST_SIZE}
    `;
    return reply.send(createSuccessResponse({ transactions }));
  });
}

export async function checkoutRoutes(fastify: FastifyInstance) {
  // POST /api/v1/checkout/session — Create Stripe Checkout session
  fastify.post(
    '/session',
    { onRequest: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!STRIPE_SECRET_KEY) {
        return reply
          .code(503)
          .send(
            createErrorResponse(
              ErrorCode.VALIDATION_ERROR,
              'Payment service not configured',
              request.url
            )
          );
      }

      const body = CheckoutSchema.parse(request.body);
      const userId = request.user.userId;

      // Get or create Stripe customer
      const userSub = await db.$queryRaw<Array<{ stripe_customer_id: string | null }>>`
        SELECT stripe_customer_id FROM public.user_subscriptions WHERE user_id = ${userId}::uuid
      `;

      // TODO: Implement actual Stripe API call when keys are configured
      // const stripe = new Stripe(STRIPE_SECRET_KEY);
      // const session = await stripe.checkout.sessions.create({...});

      return reply.send(
        createSuccessResponse({
          message: 'Stripe checkout not yet configured. Set STRIPE_SECRET_KEY to enable.',
          customerId: userSub[0]?.stripe_customer_id,
          priceId: body.priceId,
        })
      );
    }
  );

  // POST /api/v1/checkout/portal — Stripe Customer Portal session
  fastify.post(
    '/portal',
    { onRequest: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!STRIPE_SECRET_KEY) {
        return reply
          .code(503)
          .send(
            createErrorResponse(
              ErrorCode.VALIDATION_ERROR,
              'Payment service not configured',
              request.url
            )
          );
      }

      return reply.send(
        createSuccessResponse({
          message: 'Stripe portal not yet configured. Set STRIPE_SECRET_KEY to enable.',
        })
      );
    }
  );
}

export async function stripeWebhookRoutes(fastify: FastifyInstance) {
  // POST /api/v1/webhooks/stripe — Stripe webhook handler
  fastify.post('/', {}, async (request: FastifyRequest, reply: FastifyReply) => {
    if (!STRIPE_WEBHOOK_SECRET) {
      return reply.code(503).send({ error: 'Webhook not configured' });
    }

    const sig = request.headers['stripe-signature'] as string;
    if (!sig) {
      return reply.code(400).send({ error: 'Missing stripe-signature header' });
    }

    // TODO: Verify signature and process events when Stripe is configured
    // const event = stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET);
    // switch (event.type) {
    //   case 'checkout.session.completed': ...
    //   case 'invoice.paid': ...
    //   case 'invoice.payment_failed': ...
    //   case 'customer.subscription.updated': ...
    //   case 'customer.subscription.deleted': ...
    // }

    fastify.log.info(
      { type: 'stripe_webhook', sig: sig.slice(0, 20) },
      'Stripe webhook received (not processed — keys not configured)'
    );
    return reply.send({ received: true });
  });
}
