/**
 * CP489+ — v4 LLM-arbiter PoC runs data source (admin-only).
 *
 * Reads PoC run results (JSON files) from `V4_ARBITER_RUNS_DIR` (default
 * `/var/insighta/v4-runs/`) and returns them as `{ scenarios: {...} }`
 * for the admin dashboard at `/admin/v4-arbiter-runs`.
 *
 * Run JSON files MUST conform to handoff §11.4 schema. Operator drops
 * files into the dir; this endpoint never writes.
 *
 * Auth: admin JWT (same pattern as other /api/v1/admin/* routes).
 */

import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import * as fs from 'fs';
import * as path from 'path';

import { logger } from '@/utils/logger';

const log = logger.child({ module: 'api/admin/v4-arbiter-runs' });

const DEFAULT_DIR = '/var/insighta/v4-runs';
const MAX_FILES = 50;

function loadScenarios(): Record<string, unknown> {
  const dir = process.env['V4_ARBITER_RUNS_DIR'] ?? DEFAULT_DIR;
  if (!fs.existsSync(dir)) {
    log.info('v4-arbiter-runs dir missing — returning empty', { dir });
    return {};
  }
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .slice(0, MAX_FILES);
  const scenarios: Record<string, unknown> = {};
  for (const f of files) {
    const fp = path.join(dir, f);
    try {
      const txt = fs.readFileSync(fp, 'utf-8');
      const parsed = JSON.parse(txt) as Record<string, unknown>;
      const key = f.replace(/\.json$/, '');
      scenarios[key] = parsed;
    } catch (err) {
      log.warn('v4-arbiter-runs parse skip', {
        file: f,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return scenarios;
}

export async function adminV4ArbiterRunsRoutes(fastify: FastifyInstance) {
  const adminAuth = { onRequest: [fastify.authenticate, fastify.authenticateAdmin] };

  fastify.get('/', adminAuth, async (_request: FastifyRequest, reply: FastifyReply) => {
    const scenarios = loadScenarios();
    return reply.send({
      scenarios,
      count: Object.keys(scenarios).length,
      source: process.env['V4_ARBITER_RUNS_DIR'] ?? DEFAULT_DIR,
    });
  });
}
