/**
 * The corpus: the rows a run is working on, and the only place a stage may
 * read them from.
 *
 * The rule the pipeline is built on says a number that cannot be read back out
 * of the ledger does not go on the page. That rule was unenforceable while the
 * items themselves lived in a local array — the ledger could say 457 survived
 * and nobody could ask which 457. Every stage now hands its result to this
 * module and reads its input back from it, so the funnel and the corpus are
 * the same statement rather than two accounts of one run.
 */

import { getPrismaClient } from '@/modules/database/client';
import { logger } from '@/utils/logger';
import type { PipelineStage } from '../pipeline-ledger';

const log = logger.child({ module: 'newsletter/corpus' });

export interface CorpusRow {
  videoId: string;
  title: string;
  channelId: string;
  channelTitle: string;
  publishedAt: Date;
  durationSeconds: number | null;
  viewCount: number | null;
  source: 'trusted' | 'search';
  query: string | null;
  stage: PipelineStage;
  verdict: Record<string, unknown> | null;
  enrichment: Record<string, unknown> | null;
  corroboration: Record<string, unknown> | null;
}

interface DbRow {
  video_id: string;
  title: string;
  channel_id: string;
  channel_title: string;
  published_at: Date;
  duration_seconds: number | null;
  view_count: bigint | null;
  source: string;
  query: string | null;
  stage: string;
  verdict: Record<string, unknown> | null;
  enrichment: Record<string, unknown> | null;
  corroboration: Record<string, unknown> | null;
}

function toRow(r: DbRow): CorpusRow {
  return {
    videoId: r.video_id,
    title: r.title,
    channelId: r.channel_id,
    channelTitle: r.channel_title,
    publishedAt: r.published_at,
    durationSeconds: r.duration_seconds,
    viewCount: r.view_count === null ? null : Number(r.view_count),
    source: r.source === 'trusted' ? 'trusted' : 'search',
    query: r.query,
    stage: r.stage as PipelineStage,
    verdict: r.verdict,
    enrichment: r.enrichment,
    corroboration: r.corroboration,
  };
}

export interface SeedInput {
  videoId: string;
  title: string;
  channelId: string;
  channelTitle: string;
  publishedAt: string | Date;
  durationSeconds?: number | undefined;
  viewCount?: number | undefined;
  source: 'trusted' | 'search';
  query?: string | undefined;
}

/**
 * Write what the harvest found.
 *
 * Idempotent on (run_id, video_id) so a re-run of S0 after a crash does not
 * duplicate, and so the "first layer wins" rule the harvest applies in memory
 * survives into the table: a video seen by both layers keeps the trusted row.
 */
export async function seed(runId: string, videos: SeedInput[]): Promise<number> {
  if (videos.length === 0) return 0;
  const prisma = getPrismaClient();

  // Chunked: a single statement with 800 rows of parameters is where the
  // pooler starts refusing, and the harvest routinely returns more than that.
  const CHUNK = 200;
  let written = 0;
  for (let i = 0; i < videos.length; i += CHUNK) {
    const chunk = videos.slice(i, i + CHUNK);
    const values = chunk.map(
      (v) =>
        `(${[
          `'${runId}'::uuid`,
          quote(v.videoId),
          quote(v.title),
          quote(v.channelId),
          quote(v.channelTitle),
          `'${new Date(v.publishedAt).toISOString()}'::timestamptz`,
          v.durationSeconds ?? 'NULL',
          v.viewCount ?? 'NULL',
          quote(v.source),
          v.query === undefined ? 'NULL' : quote(v.query),
        ].join(',')})`
    );
    written += await prisma.$executeRawUnsafe(
      `INSERT INTO newsletter_corpus
         (run_id, video_id, title, channel_id, channel_title, published_at,
          duration_seconds, view_count, source, query)
       VALUES ${values.join(',')}
       ON CONFLICT (run_id, video_id) DO NOTHING`
    );
  }
  log.info('corpus seeded', { runId, offered: videos.length, written });
  return written;
}

/** Postgres string literal. The only values reaching it are API responses. */
function quote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

/** The rows that reached `stage` and are still in play. */
export async function readStage(runId: string, stage: PipelineStage): Promise<CorpusRow[]> {
  const rows = await getPrismaClient().$queryRaw<DbRow[]>`
    SELECT video_id, title, channel_id, channel_title, published_at, duration_seconds,
           view_count, source, query, stage, verdict, enrichment, corroboration
      FROM newsletter_corpus
     WHERE run_id = ${runId}::uuid AND stage = ${stage} AND dropped_at_stage IS NULL
     ORDER BY published_at DESC
  `;
  return rows.map(toRow);
}

/** Everything a run ever held, dropped rows included. The audit view. */
export async function readAll(
  runId: string
): Promise<Array<CorpusRow & { droppedAtStage: string | null; dropReason: string | null }>> {
  const rows = await getPrismaClient().$queryRaw<
    Array<DbRow & { dropped_at_stage: string | null; drop_reason: string | null }>
  >`
    SELECT video_id, title, channel_id, channel_title, published_at, duration_seconds,
           view_count, source, query, stage, verdict, enrichment, corroboration,
           dropped_at_stage, drop_reason
      FROM newsletter_corpus
     WHERE run_id = ${runId}::uuid
     ORDER BY published_at DESC
  `;
  return rows.map((r) => ({
    ...toRow(r),
    droppedAtStage: r.dropped_at_stage,
    dropReason: r.drop_reason,
  }));
}

export interface Advance {
  videoId: string;
  verdict?: Record<string, unknown> | undefined;
  enrichment?: Record<string, unknown> | undefined;
  corroboration?: Record<string, unknown> | undefined;
}

/**
 * Move survivors forward and record why the rest stopped.
 *
 * One transaction: a stage that advanced half its rows and then failed would
 * leave a corpus that no longer matches its own ledger row, and the next run
 * would resume from a state that never existed.
 */
export async function commitStage(
  runId: string,
  stage: PipelineStage,
  survivors: Advance[],
  drops: Array<{ videoId: string; reason: string; verdict?: Record<string, unknown> | undefined }>
): Promise<void> {
  const prisma = getPrismaClient();
  await prisma.$transaction(async (tx) => {
    for (const s of survivors) {
      await tx.$executeRaw`
        UPDATE newsletter_corpus
           SET stage = ${stage},
               verdict = COALESCE(${s.verdict ?? null}::jsonb, verdict),
               enrichment = COALESCE(${s.enrichment ?? null}::jsonb, enrichment),
               corroboration = COALESCE(${s.corroboration ?? null}::jsonb, corroboration),
               updated_at = now()
         WHERE run_id = ${runId}::uuid AND video_id = ${s.videoId}
      `;
    }
    for (const d of drops) {
      // The verdict that rejected it is written too. A corpus that records
      // only the survivors' reasoning answers "why is this here" and not
      // "why is this not here", and the second question is the one an editor
      // checking a brief actually asks.
      await tx.$executeRaw`
        UPDATE newsletter_corpus
           SET dropped_at_stage = ${stage},
               drop_reason = ${d.reason},
               verdict = COALESCE(${d.verdict ?? null}::jsonb, verdict),
               updated_at = now()
         WHERE run_id = ${runId}::uuid AND video_id = ${d.videoId}
      `;
    }
  });
  log.info('corpus stage committed', {
    runId,
    stage,
    survivors: survivors.length,
    drops: drops.length,
  });
}

/** Counts by stage, for the audit and for S6. */
export async function funnelFromCorpus(
  runId: string
): Promise<Array<{ stage: string; alive: number; dropped: number }>> {
  const rows = await getPrismaClient().$queryRaw<
    Array<{ stage: string; alive: bigint; dropped: bigint }>
  >`
    SELECT stage,
           count(*) FILTER (WHERE dropped_at_stage IS NULL)     AS alive,
           count(*) FILTER (WHERE dropped_at_stage IS NOT NULL) AS dropped
      FROM newsletter_corpus
     WHERE run_id = ${runId}::uuid
     GROUP BY stage
     ORDER BY stage
  `;
  return rows.map((r) => ({
    stage: r.stage,
    alive: Number(r.alive),
    dropped: Number(r.dropped),
  }));
}
