/**
 * Card experiment ("track 2") — dry-run replay of an externally collected
 * video list through the existing engine filters. No new searches, no DB
 * writes, no LLM calls (relevance uses the embedding service already used by
 * serving).
 *
 *   node dist/scripts/card-experiment.js --ids-file ids.json \
 *     [--cells-file cells.json] [--out result.json] [--threshold 0.25]
 *
 *   ids.json   : [{ "videoId": "...", "cell": "optional label" }, ...]
 *   cells.json : { "cellLabel": "cell description", ... }
 *
 * Record mode (shadow measurement; counts only, never comment text):
 *
 *   node dist/scripts/card-experiment.js --record --items-file items.json \
 *     --run-id <id> --cells-file cells.json [--out result.json] [--write-db]
 *
 *   items.json : [{ videoId, cell, branch: 'track1'|'track2', sourceKind,
 *                   keyword?, discoveryPaths?, subCell? }, ...]
 *   cells.json : { "feedCell": ["description", ...], ... }
 *   --write-db : upsert rows into candidate_features (needs
 *                MEASUREMENT_RECORD_ENABLED=true; default off)
 */

import { readFileSync, writeFileSync } from 'node:fs';

import { resolveVideosApiKeys } from '@/skills/plugins/video-discover/v2/youtube-client';
import { recordCandidates, runCardExperiment } from '@/modules/card-experiment';
import type { ExperimentItem, RecordItem } from '@/modules/card-experiment';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'card-experiment-cli' });

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

async function mainRecord(): Promise<void> {
  const itemsFile = argValue('--items-file');
  if (!itemsFile) throw new Error('--items-file is required with --record');
  const runId = argValue('--run-id');
  if (!runId) throw new Error('--run-id is required with --record');
  const cellsFile = argValue('--cells-file');
  const outPath = argValue('--out');
  const thresholdArg = argValue('--threshold');

  const items = readJson<RecordItem[]>(itemsFile);
  const cellDescriptions = cellsFile ? readJson<Record<string, string[]>>(cellsFile) : {};
  const apiKeys = resolveVideosApiKeys(process.env);
  if (apiKeys.length === 0) throw new Error('no YouTube API key configured');

  const out = await recordCandidates({
    items,
    runId,
    cellDescriptions,
    apiKeys,
    writeDb: hasFlag('--write-db'),
    ...(thresholdArg !== undefined ? { relevanceThreshold: Number(thresholdArg) } : {}),
  });

  const f = out.funnel;
  log.info(`total=${f.total} found=${f.found} notFound=${f.notFound}`);
  for (const [name, n] of Object.entries(f.failedByFilter)) {
    log.info(`filter=${name} failed=${n}`);
  }
  log.info(`finalPass=${f.finalPass} capped=${f.capped}`);
  const u = out.units;
  log.info(
    `units videos=${u.videos} channels=${u.channels} playlistItems=${u.playlistItems} commentThreads=${u.commentThreads}`
  );
  log.info(`records=${out.records.length} written=${out.written}`);

  if (outPath) {
    writeFileSync(outPath, JSON.stringify(out, null, 2));
    log.info(`wrote ${outPath}`);
  }
}

async function main(): Promise<void> {
  if (hasFlag('--record')) {
    await mainRecord();
    return;
  }
  const idsFile = argValue('--ids-file');
  if (!idsFile) throw new Error('--ids-file is required');
  const cellsFile = argValue('--cells-file');
  const outPath = argValue('--out');
  const thresholdArg = argValue('--threshold');

  const items = readJson<ExperimentItem[]>(idsFile);
  const cells = cellsFile ? readJson<Record<string, string>>(cellsFile) : undefined;
  const apiKeys = resolveVideosApiKeys(process.env);
  if (apiKeys.length === 0) throw new Error('no YouTube API key configured');

  const out = await runCardExperiment({
    items,
    cells,
    apiKeys,
    ...(thresholdArg !== undefined ? { relevanceThreshold: Number(thresholdArg) } : {}),
  });

  const f = out.funnel;
  log.info(`total=${f.total} found=${f.found} notFound=${f.notFound}`);
  for (const step of f.sequential) {
    log.info(
      `filter=${step.filter} removed=${step.removed} remaining=${step.remaining} failedAny=${
        step.filter === 'channel_cap' ? f.capped : f.failedByFilter[step.filter]
      }`
    );
  }
  log.info(`finalPass=${f.finalPass} capped=${f.capped}`);

  if (outPath) {
    writeFileSync(outPath, JSON.stringify(out, null, 2));
    log.info(`wrote ${outPath}`);
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    log.error(`card-experiment failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
);
