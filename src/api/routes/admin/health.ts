import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { db } from '../../../modules/database/client';
import { createSuccessResponse } from '../../schemas/common.schema';

export async function adminHealthRoutes(fastify: FastifyInstance) {
  const adminAuth = { onRequest: [fastify.authenticate, fastify.authenticateAdmin] };

  // GET /api/v1/admin/health — System health dashboard data
  fastify.get('/', adminAuth, async (_request: FastifyRequest, reply: FastifyReply) => {
    const startTime = Date.now();

    // DB connection check + stats
    let dbStatus: 'healthy' | 'degraded' | 'down' = 'down';
    let dbLatencyMs = 0;
    let dbConnections = 0;

    try {
      const dbStart = Date.now();
      const connResult = await db.$queryRaw<Array<{ count: number }>>`
        SELECT COUNT(*)::int as count FROM pg_stat_activity WHERE state = 'active'
      `;
      dbLatencyMs = Date.now() - dbStart;
      dbConnections = connResult[0]?.count ?? 0;
      dbStatus = dbLatencyMs < 500 ? 'healthy' : 'degraded';
    } catch {
      dbStatus = 'down';
    }

    // Table sizes
    const tableSizes = await db.$queryRaw<Array<{ table_name: string; row_count: number }>>`
      SELECT
        relname as table_name,
        n_live_tup::int as row_count
      FROM pg_stat_user_tables
      WHERE schemaname = 'public'
      ORDER BY n_live_tup DESC
      LIMIT 15
    `;

    // API uptime
    const uptime = process.uptime();

    // Memory usage
    const mem = process.memoryUsage();

    return reply.send(
      createSuccessResponse({
        api: {
          status: 'healthy',
          uptime: Math.floor(uptime),
          responseTimeMs: Date.now() - startTime,
          memory: {
            heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
            heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
            rssMB: Math.round(mem.rss / 1024 / 1024),
          },
        },
        database: {
          status: dbStatus,
          latencyMs: dbLatencyMs,
          activeConnections: dbConnections,
          tableSizes,
        },
        environment: {
          nodeVersion: process.version,
          platform: process.platform,
        },
      })
    );
  });
}
