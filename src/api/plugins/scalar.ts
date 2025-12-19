import { FastifyInstance } from 'fastify';

/**
 * Scalar Plugin Configuration
 *
 * Provides modern, interactive API reference documentation
 * powered by Scalar. More user-friendly alternative to Swagger UI.
 *
 * Note: Uses dynamic import for ESM module compatibility in serverless environments.
 */

export async function registerScalar(fastify: FastifyInstance) {
  // Dynamic import for ESM module compatibility (required for Vercel serverless)
  const scalarPlugin = (await import('@scalar/fastify-api-reference')).default;

  await fastify.register(scalarPlugin, {
    routePrefix: '/api-reference',
    configuration: {
      theme: 'purple',
      layout: 'modern',
      defaultHttpClient: {
        targetKey: 'javascript',
        clientKey: 'fetch',
      },
      authentication: {
        preferredSecurityScheme: 'bearerAuth',
        http: {
          bearer: {
            token: 'your-access-token-here',
          },
        },
      },
      spec: {
        url: '/documentation/json',
      },
      metaData: {
        title: 'YouTube Playlist Sync API Reference',
        description: 'Interactive API documentation for YouTube Playlist Sync service',
        ogDescription: 'REST API for YouTube playlist synchronization and learning management',
        ogTitle: 'YouTube Playlist Sync API',
        ogImage: 'https://example.com/og-image.png',
        twitterCard: 'summary_large_image',
      },
      searchHotKey: 'k',
      servers: [
        {
          url: 'http://localhost:3000',
          description: 'Development',
        },
        {
          url: 'https://api.yourdomain.com',
          description: 'Production',
        },
      ],
      defaultOpenAllTags: false,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
      hiddenClients: [],
      showSidebar: true,
      customCss: `
        .references-item:hover {
          background-color: rgba(139, 92, 246, 0.1);
        }
      `,
    },
  });

  fastify.log.info('Scalar API reference registered at /api-reference');
}
