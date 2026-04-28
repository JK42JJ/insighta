import Fastify, { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { registerRateLimit } from './plugins/rate-limit';
import dotenv from 'dotenv';
import { Prisma } from '@prisma/client';
import { registerAuth } from './plugins/auth';
import { authRoutes } from './routes/auth';
import { playlistRoutes } from './routes/playlists';
import { videoRoutes } from './routes/videos';
import { videoRichNotesRoutes } from './routes/video-rich-notes';
import { noteRoutes } from './routes/notes';
import { analyticsRoutes } from './routes/analytics';
import { syncRoutes } from './routes/sync';
import { quotaRoutes } from './routes/quota';
import { mandalaRoutes } from './routes/mandalas';
import { imageRoutes } from './routes/images';
import { ontologyRoutes } from './routes/ontology';
import { llmRoutes } from './routes/llm';
import { adminRoutes } from './routes/admin';
import { subscriptionRoutes } from './routes/subscriptions';
import { snapshotRoutes } from './routes/snapshots';
import { botRoutes } from './routes/bot';
import { settingsRoutes } from './routes/settings';
import { youtubeRoutes } from './routes/youtube';
import { sharingRoutes } from './routes/sharing';
import { skillRoutes } from './routes/skills';
import { copilotKitRoutes } from './routes/copilotkit';
import { internalBatchVideoCollectorRoutes } from './routes/internal/batch-video-collector';
import { internalTrendCollectorRoutes } from './routes/internal/trend-collector';
import { createErrorResponse, ErrorCode } from './schemas/common.schema';
import { registerBotWriteGuard } from './plugins/bot-write-guard';
import { registerBotUsageLogger } from './plugins/bot-usage-logger';
import {
  testDatabaseConnection,
  disconnectDatabase,
  resetConnectionPool,
} from '../modules/database/client';
import { getClawbot } from '../modules/scheduler/clawbot';
import { initJobQueue, getJobQueue } from '../modules/queue';
import { getAutoSyncScheduler } from '../modules/scheduler/auto-sync';
import {
  startRichSummaryV2Cron,
  stopRichSummaryV2Cron,
} from '../modules/scheduler/rich-summary-v2-cron';

// Load environment variables
dotenv.config();

/**
 * Create and configure Fastify server instance
 */
export async function buildServer() {
  const fastify = Fastify({
    logger: {
      level: process.env['LOG_LEVEL'] || 'info',
    },
    ajv: {
      customOptions: {
        removeAdditional: 'all',
        coerceTypes: true,
        useDefaults: true,
        strict: false, // Allow OpenAPI-specific keywords like 'example'
      },
    },
    requestIdHeader: 'x-request-id',
    requestIdLogLabel: 'requestId',
    disableRequestLogging: false,
    trustProxy: true,
  });

  // ============================================================================
  // Security & Infrastructure Plugins
  // ============================================================================

  // CORS configuration
  await fastify.register(cors, {
    origin: process.env['CORS_ORIGIN']?.split(',') || ['http://localhost:3000'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 86400, // 24 hours
  });

  // Security headers
  await fastify.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
        imgSrc: ["'self'", 'data:', 'https:'],
      },
    },
    crossOriginEmbedderPolicy: false,
  });

  // Rate limiting — 3-tier architecture (see src/api/plugins/rate-limit.ts).
  //
  // Tier 1: global safety net (auth 200/min writes, unauth 30/min all)
  // Tier 2: GET exempt for authenticated users (reads are free)
  // Tier 3: per-endpoint budgets via route config (LLM, vector search, etc.)
  //
  // The plugin was written 2026-04-10 but never wired in. server.ts was
  // using a raw 100/15min global bucket that killed the service when a
  // user refreshed 13 times (2026-04-17 incident). Now activated.
  await registerRateLimit(fastify);

  // ============================================================================
  // Authentication Plugin
  // ============================================================================

  await registerAuth(fastify);

  // Bot write guard — blocks bot write operations without approval token
  await registerBotWriteGuard(fastify);

  // Bot usage logger — tracks bot API requests for Phase 0 pattern analysis (#309)
  await registerBotUsageLogger(fastify);

  // ============================================================================
  // Documentation Plugins (skip in test mode and serverless)
  // ============================================================================

  const isServerless = !!(
    process.env['VERCEL'] ||
    process.env['AWS_LAMBDA_FUNCTION_NAME'] ||
    process.env['FUNCTION_NAME']
  );

  if (process.env['NODE_ENV'] !== 'test' && !isServerless) {
    // Use dynamic imports to avoid loading ESM modules in Jest
    // Note: Scalar uses ESM-only modules that don't work in Vercel's CommonJS environment
    const { registerSwagger } = await import('./plugins/swagger');
    const { registerScalar } = await import('./plugins/scalar');
    await registerSwagger(fastify);
    await registerScalar(fastify);
  } else if (process.env['NODE_ENV'] !== 'test') {
    // In serverless, only register Swagger (works with CommonJS)
    const { registerSwagger } = await import('./plugins/swagger');
    await registerSwagger(fastify);
  }

  // ============================================================================
  // Health Check Routes
  // ============================================================================

  fastify.get('/health', {
    schema: {
      description: 'Health check endpoint',
      tags: ['health'],
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['ok'] },
            timestamp: { type: 'string', format: 'date-time' },
            uptime: { type: 'number' },
            version: { type: 'string' },
          },
        },
      },
    },
    handler: async (_request, reply) => {
      return reply.code(200).send({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: process.env['npm_package_version'] || '1.0.0',
      });
    },
  });

  fastify.get('/health/ready', {
    schema: {
      description: 'Readiness probe for Kubernetes',
      tags: ['health'],
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['ready'] },
            database: { type: 'string' },
          },
        },
        503: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            database: { type: 'string' },
          },
        },
      },
    },
    handler: async (_request, reply) => {
      const dbOk = await testDatabaseConnection();
      if (!dbOk) {
        return reply.code(503).send({ status: 'not_ready', database: 'disconnected' });
      }
      return reply.code(200).send({ status: 'ready', database: 'connected' });
    },
  });

  // ============================================================================
  // API Routes (will be added progressively)
  // ============================================================================

  // API version prefix
  void fastify.register(
    async (instance) => {
      // Health check for API version
      instance.get('/', async (_request, reply) => {
        return reply.send({
          version: 'v1',
          endpoints: {
            health: '/health',
            documentation: '/documentation',
            apiReference: '/api-reference',
          },
        });
      });

      // Register auth routes
      await instance.register(authRoutes, { prefix: '/auth' });

      // Register playlist routes
      await instance.register(playlistRoutes, { prefix: '/playlists' });

      // Register videos routes
      await instance.register(videoRoutes, { prefix: '/videos' });

      // Register rich-notes routes (Notion-style side editor — Phase 1-4 MVP)
      // Intentionally kept in a separate plugin to avoid conflicts with videos.ts.
      // Paths are `/rich-notes/:cardId` (GET, PATCH).
      await instance.register(videoRichNotesRoutes);

      // Register notes routes (notes are nested under videos for create/list, but top-level for get/update/delete)
      await instance.register(noteRoutes, { prefix: '/notes' });

      // Register analytics routes
      await instance.register(analyticsRoutes, { prefix: '/analytics' });

      // Register sync routes
      await instance.register(syncRoutes, { prefix: '/sync' });

      // Register quota routes
      await instance.register(quotaRoutes, { prefix: '/quota' });

      // Register mandala routes
      await instance.register(mandalaRoutes, { prefix: '/mandalas' });

      // Register image proxy routes
      await instance.register(imageRoutes, { prefix: '/images' });

      // Register ontology routes (GraphRAG knowledge graph)
      await instance.register(ontologyRoutes, { prefix: '/ontology' });

      // Register LLM provider routes (status, health)
      await instance.register(llmRoutes, { prefix: '/llm' });

      // Register subscription routes (mandala subscription graph)
      await instance.register(subscriptionRoutes, { prefix: '/subscriptions' });

      // Register snapshot routes (card state backup/rollback for bot safety)
      await instance.register(snapshotRoutes, { prefix: '/snapshots' });

      // Register bot approval routes (write approval flow)
      await instance.register(botRoutes, { prefix: '/bot' });

      // Register settings routes (LLM keys management)
      await instance.register(settingsRoutes, { prefix: '/settings' });

      // Register YouTube library routes (subscriptions, playlists)
      await instance.register(youtubeRoutes, { prefix: '/youtube' });

      // Register sharing routes (mandala share links, clone)
      await instance.register(sharingRoutes, { prefix: '/sharing' });

      // Register skills routes (SkillRegistry — newsletter, report, etc.)
      await instance.register(skillRoutes, { prefix: '/skills' });

      // Register CopilotKit runtime routes (AI chatbot)
      await instance.register(copilotKitRoutes, { prefix: '/chat' });

      // Register admin routes (requires is_super_admin)
      await instance.register(adminRoutes, { prefix: '/admin' });

      // Internal routes — protected by shared token (x-internal-token),
      // used by GitHub Actions cron for batch jobs. Do NOT expose these
      // to the browser; the token bypasses per-user auth.
      await instance.register(internalBatchVideoCollectorRoutes, {
        prefix: '/internal/skills',
      });
      await instance.register(internalTrendCollectorRoutes, {
        prefix: '/internal/skills',
      });
    },
    { prefix: '/api/v1' }
  );

  // ============================================================================
  // Error Handlers
  // ============================================================================

  // Custom error handler
  fastify.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    // DEBUG: log all errors to stdout
    console.error(
      `\n=== ERROR HANDLER === ${request.method} ${request.url}\n`,
      error.message,
      '\n',
      error.stack?.substring(0, 500),
      '\n===\n'
    );
    // Handle Prisma-specific errors
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      const prismaStatusMap: Record<string, { status: number; code: ErrorCode }> = {
        P2025: { status: 404, code: ErrorCode.RESOURCE_NOT_FOUND },
        P2002: { status: 409, code: ErrorCode.DUPLICATE_RESOURCE },
        P2003: { status: 400, code: ErrorCode.INVALID_INPUT },
        P2014: { status: 400, code: ErrorCode.INVALID_INPUT },
      };
      const mapped = prismaStatusMap[error.code];
      if (mapped) {
        fastify.log.warn(
          { err: error, requestId: request.id, url: request.url },
          `Prisma error ${error.code}`
        );
        return reply
          .code(mapped.status)
          .send(
            createErrorResponse(mapped.code, error.message, request.url, { prismaCode: error.code })
          );
      }
      // Unmapped Prisma errors → 500
      fastify.log.error(
        { err: error, requestId: request.id, url: request.url },
        `Prisma error ${error.code}`
      );
      return reply
        .code(500)
        .send(
          createErrorResponse(ErrorCode.DATABASE_ERROR, 'A database error occurred', request.url)
        );
    }

    // Auto-reset stale connection pool on connection errors
    const isConnectionErr =
      (error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2024', 'P1017', 'P1001', 'P1002'].includes(error.code)) ||
      error.message?.includes('connection pool') ||
      error.message?.includes('Connection refused');
    if (isConnectionErr) {
      resetConnectionPool().catch(() => {});
      fastify.log.warn('Prisma connection pool reset due to connection error');
      return reply
        .code(503)
        .send(
          createErrorResponse(
            ErrorCode.SERVICE_UNAVAILABLE,
            'Database temporarily unavailable, please retry',
            request.url
          )
        );
    }

    if (error instanceof Prisma.PrismaClientInitializationError) {
      resetConnectionPool().catch(() => {});
      fastify.log.error(
        { err: error, requestId: request.id, url: request.url },
        'Prisma initialization error'
      );
      return reply
        .code(503)
        .send(
          createErrorResponse(
            ErrorCode.SERVICE_UNAVAILABLE,
            'Database service unavailable',
            request.url
          )
        );
    }

    if (error instanceof Prisma.PrismaClientRustPanicError) {
      fastify.log.error(
        { err: error, requestId: request.id, url: request.url },
        'Prisma engine panic'
      );
      return reply
        .code(500)
        .send(
          createErrorResponse(
            ErrorCode.INTERNAL_SERVER_ERROR,
            'An internal server error occurred',
            request.url
          )
        );
    }

    const statusCode = error.statusCode || 500;

    // Log error
    if (statusCode >= 500) {
      fastify.log.error(
        {
          err: error,
          requestId: request.id,
          url: request.url,
          method: request.method,
        },
        'Internal server error'
      );
    } else {
      fastify.log.warn(
        {
          err: error,
          requestId: request.id,
          url: request.url,
          method: request.method,
        },
        'Client error'
      );
    }

    // Validation errors (400)
    if (error.validation) {
      return reply.code(400).send(
        createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Request validation failed', request.url, {
          validation: error.validation,
        })
      );
    }

    // Generic error response
    const errorCode = statusCode >= 500 ? ErrorCode.INTERNAL_SERVER_ERROR : ErrorCode.INVALID_INPUT;

    const message =
      statusCode >= 500 ? 'An internal server error occurred' : error.message || 'Bad request';

    return reply.code(statusCode).send(createErrorResponse(errorCode, message, request.url));
  });

  // 404 handler
  fastify.setNotFoundHandler((request, reply) => {
    return reply
      .code(404)
      .send(
        createErrorResponse(
          ErrorCode.RESOURCE_NOT_FOUND,
          `Route ${request.method} ${request.url} not found`,
          request.url
        )
      );
  });

  return fastify;
}

/**
 * Start the server
 */
export async function startServer() {
  try {
    const fastify = await buildServer();

    const port = parseInt(process.env['API_PORT'] || '3000', 10);
    const host = process.env['API_HOST'] || '0.0.0.0';

    await fastify.listen({ port, host });

    fastify.log.info(`Server listening on http://${host}:${port}`);
    fastify.log.info(`Swagger UI available at http://${host}:${port}/documentation`);
    fastify.log.info(`Scalar API Reference available at http://${host}:${port}/api-reference`);

    // Clawbot + EnrichmentScheduler — DISABLED (2026-03-27)
    // Both superseded by pg-boss JobQueue (persistent, Postgres-backed)
    // Rollback: re-enable getEnrichmentScheduler().start() in enrichment/scheduler.ts
    fastify.log.info('Clawbot + EnrichmentScheduler DISABLED — superseded by pg-boss JobQueue');

    // Job Queue (pg-boss) — persistent job scheduling
    // Replaces EnrichmentScheduler (Phase 2 complete)
    // batch-scan: cron */30 → enrich-video jobs (health-adaptive)
    try {
      await initJobQueue();
      fastify.log.info('JobQueue initialized (pg-boss + enrich-video + batch-scan)');
    } catch (err) {
      fastify.log.warn({ err }, 'JobQueue init failed (non-fatal)');
    }

    // Auto-sync scheduler — periodic playlist synchronization
    try {
      await getAutoSyncScheduler().start();
      fastify.log.info('AutoSyncScheduler started');
    } catch (err) {
      fastify.log.warn({ err }, 'AutoSyncScheduler init failed (non-fatal)');
    }

    // CP437 — Rich Summary v2 cron (prod-runtime backfill of v2 columns).
    // Default OFF; flip RICH_SUMMARY_V2_CRON_ENABLED=true once Track A is
    // ready to absorb the LLM call volume.
    try {
      startRichSummaryV2Cron();
    } catch (err) {
      fastify.log.warn({ err }, 'RichSummaryV2Cron init failed (non-fatal)');
    }

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      fastify.log.info(`${signal} received, shutting down gracefully...`);
      try {
        await getClawbot().stop();
      } catch {
        /* ignore */
      }
      try {
        await getJobQueue().stop();
      } catch {
        /* ignore */
      }
      try {
        await getAutoSyncScheduler().stop();
      } catch {
        /* ignore */
      }
      try {
        stopRichSummaryV2Cron();
      } catch {
        /* ignore */
      }
      await fastify.close();
      await disconnectDatabase();
      process.exit(0);
    };

    process.on('SIGTERM', () => {
      void shutdown('SIGTERM');
    });
    process.on('SIGINT', () => {
      void shutdown('SIGINT');
    });
  } catch (err) {
    console.error('Error starting server:', err);
    process.exit(1);
  }
}

// Export buildServer as buildApp for test compatibility
export { buildServer as buildApp };

// Start server if this file is run directly
if (require.main === module) {
  void startServer();
}
