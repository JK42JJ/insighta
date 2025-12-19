/**
 * Vercel Serverless Function Handler
 *
 * This file serves as the entry point for Vercel Serverless Functions.
 * It wraps the Fastify server and handles incoming requests.
 */
import type { IncomingMessage, ServerResponse } from 'http';

// Lazy-load the server to optimize cold starts
let app: Awaited<ReturnType<typeof import('../src/api/server').buildServer>> | null = null;

/**
 * Initialize the Fastify server instance
 * Uses singleton pattern to reuse across warm function invocations
 */
async function getApp() {
  if (!app) {
    const { buildServer } = await import('../src/api/server');
    app = await buildServer();
    await app.ready();
  }
  return app;
}

/**
 * Vercel Serverless Function Handler
 * Converts Vercel's request/response to Fastify's format
 */
export default async function handler(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  try {
    const fastify = await getApp();

    // Use Fastify's built-in request handling
    await fastify.server.emit('request', req, res);
  } catch (error) {
    console.error('Serverless handler error:', error);

    // Return error response if server initialization fails
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to initialize server',
        timestamp: new Date().toISOString(),
      }
    }));
  }
}
