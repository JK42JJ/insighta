import { FastifyInstance } from 'fastify';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUI from '@fastify/swagger-ui';

/**
 * Swagger Plugin Configuration
 *
 * Configures OpenAPI 3.1 specification generation and Swagger UI
 * for API documentation and testing.
 */

export async function registerSwagger(fastify: FastifyInstance) {
  // Register @fastify/swagger for OpenAPI spec generation
  await fastify.register(fastifySwagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'YouTube Playlist Sync API',
        description: 'REST API for YouTube playlist synchronization and learning management',
        version: '1.0.0',
        contact: {
          name: 'API Support',
          email: 'support@example.com',
        },
        license: {
          name: 'MIT',
          url: 'https://opensource.org/licenses/MIT',
        },
      },
      servers: [
        {
          url: 'http://localhost:3000',
          description: 'Development server',
        },
        {
          url: 'https://api.yourdomain.com',
          description: 'Production server',
        },
      ],
      tags: [
        { name: 'auth', description: 'Authentication endpoints' },
        { name: 'playlists', description: 'Playlist management' },
        { name: 'videos', description: 'Video information and notes' },
        { name: 'analytics', description: 'Learning analytics and statistics' },
        { name: 'sync', description: 'Synchronization operations' },
        { name: 'quota', description: 'Quota usage and rate limit information' },
        { name: 'health', description: 'Health check endpoints' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'JWT access token obtained from /auth/login',
          },
          apiKey: {
            type: 'apiKey',
            name: 'X-API-Key',
            in: 'header',
            description: 'API key for service-to-service authentication',
          },
        },
      },
      externalDocs: {
        url: 'https://docs.yourdomain.com',
        description: 'Full documentation',
      },
    },
  });

  // Register @fastify/swagger-ui for interactive documentation
  await fastify.register(fastifySwaggerUI, {
    routePrefix: '/documentation',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
      displayRequestDuration: true,
      filter: true,
      showExtensions: true,
      showCommonExtensions: true,
      syntaxHighlight: {
        activate: true,
        theme: 'monokai',
      },
      tryItOutEnabled: true,
    },
    uiHooks: {
      onRequest: function (_request, _reply, next) {
        next();
      },
      preHandler: function (_request, _reply, next) {
        next();
      },
    },
    staticCSP: true,
    transformStaticCSP: (header) => header,
    transformSpecification: (swaggerObject, _request, _reply) => {
      return swaggerObject;
    },
    transformSpecificationClone: true,
  });

  fastify.log.info('Swagger plugin registered at /documentation');
}
