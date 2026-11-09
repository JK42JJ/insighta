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
 */

import { readFileSync, writeFileSync } from 'node:fs';

import { resolveVideosApiKeys } from '@/skills/plugins/video-discover/v2/youtube-client';
import { runCardExperiment } from '@/modules/card-experiment';
import type { ExperimentItem } from '@/modules/card-experiment';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'card-experiment-cli' });

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

async function main(): Promise<void> {
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
