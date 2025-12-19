import Fastify, { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import dotenv from 'dotenv';
import { registerAuth } from './plugins/auth';
import { authRoutes } from './routes/auth';
import { playlistRoutes } from './routes/playlists';
import { videoRoutes } from './routes/videos';
import { noteRoutes } from './routes/notes';
import { analyticsRoutes } from './routes/analytics';
import { syncRoutes } from './routes/sync';
import { quotaRoutes } from './routes/quota';
import { createErrorResponse, ErrorCode } from './schemas/common.schema';

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

  // Rate limiting
  await fastify.register(rateLimit, {
    max: parseInt(process.env['RATE_LIMIT_MAX'] || '100', 10),
    timeWindow: process.env['RATE_LIMIT_WINDOW'] || '15 minutes',
    errorResponseBuilder: (_request, context) => {
      return createErrorResponse(
        ErrorCode.RATE_LIMIT_EXCEEDED,
        `Rate limit exceeded. Max ${context.max} requests per ${context.after}`,
        _request.url
      );
    },
    addHeaders: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
    },
  });

  // ============================================================================
  // Authentication Plugin
  // ============================================================================

  await registerAuth(fastify);

  // ============================================================================
  // Documentation Plugins (skip in test mode)
  // ============================================================================

  if (process.env['NODE_ENV'] !== 'test') {
    // Use dynamic imports to avoid loading ESM modules in Jest
    const { registerSwagger } = await import('./plugins/swagger');
    const { registerScalar } = await import('./plugins/scalar');
    await registerSwagger(fastify);
    await registerScalar(fastify);
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
          },
        },
      },
    },
    handler: async (_request, reply) => {
      // TODO: Add database connection check
      // TODO: Add external API availability check
      return reply.code(200).send({ status: 'ready' });
    },
  });

  // ============================================================================
  // API Routes (will be added progressively)
  // ============================================================================

  // API version prefix
  fastify.register(
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

      // Register notes routes (notes are nested under videos for create/list, but top-level for get/update/delete)
      await instance.register(noteRoutes, { prefix: '/notes' });

      // Register analytics routes
      await instance.register(analyticsRoutes, { prefix: '/analytics' });

      // Register sync routes
      await instance.register(syncRoutes, { prefix: '/sync' });

      // Register quota routes
      await instance.register(quotaRoutes, { prefix: '/quota' });
    },
    { prefix: '/api/v1' }
  );

  // ============================================================================
  // Error Handlers
  // ============================================================================

  // Custom error handler
  fastify.setErrorHandler(
    (error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
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
          createErrorResponse(
            ErrorCode.VALIDATION_ERROR,
            'Request validation failed',
            request.url,
            {
              validation: error.validation,
            }
          )
        );
      }

      // Generic error response
      const errorCode =
        statusCode >= 500
          ? ErrorCode.INTERNAL_SERVER_ERROR
          : ErrorCode.INVALID_INPUT;

      const message =
        statusCode >= 500
          ? 'An internal server error occurred'
          : error.message || 'Bad request';

      return reply
        .code(statusCode)
        .send(createErrorResponse(errorCode, message, request.url));
    }
  );

  // 404 handler
  fastify.setNotFoundHandler((request, reply) => {
    return reply.code(404).send(
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

    fastify.log.info(
      `Server listening on http://${host}:${port}`
    );
    fastify.log.info(
      `Swagger UI available at http://${host}:${port}/documentation`
    );
    fastify.log.info(
      `Scalar API Reference available at http://${host}:${port}/api-reference`
    );

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      fastify.log.info(`${signal} received, shutting down gracefully...`);
      await fastify.close();
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (err) {
    console.error('Error starting server:', err);
    process.exit(1);
  }
}

// Export buildServer as buildApp for test compatibility
export { buildServer as buildApp };

// Start server if this file is run directly
if (require.main === module) {
  startServer();
}
