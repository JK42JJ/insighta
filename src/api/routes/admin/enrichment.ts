import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { createSuccessResponse } from '../../schemas/common.schema';
import { logger } from '../../../utils/logger';
import { randomUUID } from 'crypto';
import { fork } from 'child_process';
import { resolve } from 'path';

// ============================================================================
// In-memory job store for async batch enrichment
// ============================================================================

interface EnrichJob {
  id: string;
  status: 'running' | 'completed' | 'failed';
  limit: number;
  delayMs: number;
  startedAt: string;
  completedAt: string | null;
  result: {
    total: number;
    enriched: number;
    skipped: number;
    errors: { videoId: string; error: string }[];
  } | null;
  error: string | null;
}

const MAX_JOB_HISTORY = 50;
const jobs: EnrichJob[] = [];

function addJob(job: EnrichJob): void {
  jobs.unshift(job);
  if (jobs.length > MAX_JOB_HISTORY) {
    jobs.length = MAX_JOB_HISTORY;
  }
}

function findJob(id: string): EnrichJob | undefined {
  return jobs.find((j) => j.id === id);
}

function getRunningJob(): EnrichJob | undefined {
  return jobs.find((j) => j.status === 'running');
}

// ============================================================================
// Child process worker for batch enrichment
// ============================================================================

function runEnrichInChildProcess(job: EnrichJob): void {
  const workerPath = resolve(__dirname, '../../../modules/ontology/enrich-worker.js');

  const child = fork(workerPath, [], {
    env: { ...process.env },
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
  });

  child.send({ limit: job.limit, delayMs: job.delayMs });

  child.on('message', (msg: any) => {
    if (msg.type === 'result') {
      job.status = 'completed';
      job.completedAt = new Date().toISOString();
      job.result = msg.data;
      logger.info('Batch enrichment job completed (child process)', { jobId: job.id, ...msg.data });
    }
  });

  child.on('error', (err) => {
    job.status = 'failed';
    job.completedAt = new Date().toISOString();
    job.error = err.message;
    logger.error('Batch enrichment child process error', { jobId: job.id, error: err.message });
  });

  child.on('exit', (code) => {
    if (job.status === 'running') {
      job.status = code === 0 ? 'completed' : 'failed';
      job.completedAt = new Date().toISOString();
      if (code !== 0) {
        job.error = `Child process exited with code ${code}`;
      }
    }
  });
}

// ============================================================================
// Schemas
// ============================================================================

const BatchAllBodySchema = z.object({
  limit: z.number().int().min(1).max(500).default(100),
  delay_ms: z.number().int().min(0).max(10000).default(2000),
});

const JobListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

// ============================================================================
// Routes
// ============================================================================

export async function adminEnrichmentRoutes(fastify: FastifyInstance) {
  const adminAuth = { onRequest: [fastify.authenticate, fastify.authenticateAdmin] };

  // POST /api/v1/admin/enrichment/batch-all — start async batch enrichment in child process
  fastify.post('/batch-all', adminAuth, async (request: FastifyRequest, reply: FastifyReply) => {
    const running = getRunningJob();
    if (running) {
      return reply.code(409).send({
        success: false,
        error: 'A batch job is already running',
        data: { jobId: running.id },
      });
    }

    const body = BatchAllBodySchema.parse(request.body);

    const job: EnrichJob = {
      id: randomUUID(),
      status: 'running',
      limit: body.limit,
      delayMs: body.delay_ms,
      startedAt: new Date().toISOString(),
      completedAt: null,
      result: null,
      error: null,
    };

    addJob(job);
    runEnrichInChildProcess(job);

    return reply.code(202).send(createSuccessResponse({ jobId: job.id, status: 'running' }));
  });

  // GET /api/v1/admin/enrichment/jobs — list job history
  fastify.get('/jobs', adminAuth, async (request: FastifyRequest, reply: FastifyReply) => {
    const query = JobListQuerySchema.parse(request.query);
    const items = jobs.slice(0, query.limit);
    return reply.send(createSuccessResponse({ jobs: items, total: jobs.length }));
  });

  // GET /api/v1/admin/enrichment/jobs/:id — get single job status
  fastify.get<{ Params: { id: string } }>('/jobs/:id', adminAuth, async (request, reply) => {
    const job = findJob(request.params.id);
    if (!job) {
      return reply.code(404).send({ success: false, error: 'Job not found' });
    }
    return reply.send(createSuccessResponse(job));
  });
}
