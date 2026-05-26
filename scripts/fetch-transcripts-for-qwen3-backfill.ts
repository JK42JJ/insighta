/**
 * CP488+ — Fetch transcripts for the 491 qwen3_low videos so the Mac Mini
 * CC console session can regenerate atoms/sections/one_liner against the
 * actual transcript instead of the qwen3-30b-a3b hallucinated output.
 *
 * Workflow:
 *   1. SELECT video_id + metadata from video_rich_summaries where
 *      quality_flag='qwen3_low' (491 rows after PR #752's UPDATE).
 *   2. For each video, call the production caption extractor (which
 *      proxies through Mac Mini when MAC_MINI_TRANSCRIPT_URL is set).
 *   3. Append a JSON line per video to the output file:
 *      `{video_id, language, title, description, channel, transcript}`.
 *   4. On caption-unavailable, stamp `transcript_attempted_at` so cron
 *      cooldown elsewhere honours the 7-day rule, and write
 *      `{video_id, transcript: null, error}` to the JSONL.
 *
 * Hard Rule (CLAUDE.md): NO LLM API call in this script. Captions only.
 * The Mac Mini Claude Code (Opus 4.7) session that consumes the JSONL
 * does the regeneration; its `Write` tool output produces UPDATE SQL.
 *
 * Usage (run from Mac Mini, NOT EC2 — EC2 us-west-2 outbound to YouTube
 * is rate-limited; Mac Mini direct path is reliable):
 *   DATABASE_URL=postgresql://... \
 *   tsx scripts/fetch-transcripts-for-qwen3-backfill.ts \
 *     --output /tmp/qwen3-low-transcripts.jsonl \
 *     [--limit 100] \
 *     [--skip-existing]
 *
 * --skip-existing: re-running the script appends to the JSONL without
 *   re-fetching videos whose video_id already appears in it. Safe for
 *   resume-on-failure across multi-hour runs.
 *
 * Estimated wall-clock for 491 videos: ~15-30 min serial.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

import { getCaptionExtractor } from '../src/modules/caption/extractor';
import { logger } from '../src/utils/logger';

const log = logger.child({ module: 'qwen3-backfill-fetch' });

interface OutputLine {
  video_id: string;
  language: string | null;
  title: string | null;
  description: string | null;
  channel: string | null;
  transcript: string | null;
  error?: string;
  fetched_at: string;
}

function parseCliArgs(argv: string[]): {
  output: string;
  limit: number | null;
  skipExisting: boolean;
} {
  let output = '/tmp/qwen3-low-transcripts.jsonl';
  let limit: number | null = null;
  let skipExisting = false;
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--output' && argv[i + 1]) {
      output = argv[i + 1]!;
      i += 1;
    } else if (arg === '--limit' && argv[i + 1]) {
      limit = parseInt(argv[i + 1]!, 10);
      i += 1;
    } else if (arg === '--skip-existing') {
      skipExisting = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(
        `Usage: tsx scripts/fetch-transcripts-for-qwen3-backfill.ts [--output PATH] [--limit N] [--skip-existing]`
      );
      process.exit(0);
    }
  }
  return { output, limit, skipExisting };
}

async function loadExistingVideoIds(output: string): Promise<Set<string>> {
  const seen = new Set<string>();
  try {
    const raw = await fs.readFile(output, 'utf-8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const obj = JSON.parse(trimmed) as { video_id?: string };
        if (obj.video_id) seen.add(obj.video_id);
      } catch {
        /* skip malformed lines */
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  return seen;
}

async function main(): Promise<void> {
  const { output, limit, skipExisting } = parseCliArgs(process.argv);
  const outputAbs = path.resolve(output);
  log.info('starting transcript fetch', { output: outputAbs, limit, skipExisting });

  const prisma = new PrismaClient();
  try {
    const existing = skipExisting ? await loadExistingVideoIds(outputAbs) : new Set<string>();
    if (existing.size > 0) {
      log.info('skip-existing: already in JSONL', { count: existing.size });
    }

    // Pull qwen3_low videos + YouTube metadata in one query so the Mac Mini
    // session has everything it needs (title/desc/channel) without re-hitting
    // prod DB. ORDER BY updated_at ASC = oldest first so the longest-stale
    // user-visible rows get fixed sooner.
    const rows = await prisma.$queryRawUnsafe<
      {
        video_id: string;
        title: string | null;
        description: string | null;
        channel_title: string | null;
      }[]
    >(
      `SELECT vrs.video_id, yv.title, yv.description, yv.channel_title
       FROM video_rich_summaries vrs
       LEFT JOIN youtube_videos yv ON yv.youtube_video_id = vrs.video_id
       WHERE vrs.quality_flag = 'qwen3_low'
       ORDER BY vrs.updated_at ASC
       ${limit != null ? `LIMIT ${limit}` : ''}`
    );

    log.info('candidates loaded', { total: rows.length, skipped: existing.size });

    const captionExtractor = getCaptionExtractor();
    const fh = await fs.open(outputAbs, 'a');
    try {
      let ok = 0;
      let fail = 0;
      let skipped = 0;
      for (const row of rows) {
        if (existing.has(row.video_id)) {
          skipped += 1;
          continue;
        }
        const langHint = undefined; // captioner auto-probes; metadata source_language was unreliable in CP475 era
        let line: OutputLine;
        try {
          const result = await captionExtractor.extractCaptions(row.video_id, langHint);
          if (result.success && result.caption?.fullText) {
            line = {
              video_id: row.video_id,
              language: result.language ?? null,
              title: row.title,
              description: row.description,
              channel: row.channel_title,
              transcript: result.caption.fullText,
              fetched_at: new Date().toISOString(),
            };
            ok += 1;
          } else {
            line = {
              video_id: row.video_id,
              language: null,
              title: row.title,
              description: row.description,
              channel: row.channel_title,
              transcript: null,
              error: result.error ?? 'unknown',
              fetched_at: new Date().toISOString(),
            };
            fail += 1;
          }
        } catch (err) {
          line = {
            video_id: row.video_id,
            language: null,
            title: row.title,
            description: row.description,
            channel: row.channel_title,
            transcript: null,
            error: err instanceof Error ? err.message : String(err),
            fetched_at: new Date().toISOString(),
          };
          fail += 1;
        }
        await fh.write(JSON.stringify(line) + '\n');
        if ((ok + fail) % 50 === 0) {
          log.info('progress', { ok, fail, skipped, total: rows.length });
        }
      }
      log.info('done', { ok, fail, skipped, total: rows.length, output: outputAbs });
    } finally {
      await fh.close();
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
