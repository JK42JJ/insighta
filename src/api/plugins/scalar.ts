import { FastifyInstance } from 'fastify';
import scalarPlugin from '@scalar/fastify-api-reference';

/**
 * Scalar Plugin Configuration
 *
 * Provides modern, interactive API reference documentation
 * powered by Scalar. More user-friendly alternative to Swagger UI.
 */

export async function registerScalar(fastify: FastifyInstance) {
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
