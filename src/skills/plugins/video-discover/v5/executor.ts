/**
 * v5 add-cards executor — YouTube fanout + LLM picker, no cosine, no IKS.
 *
 * Pipeline:
 *   1. YouTube parallel search.list (8 queries × allSettled)
 *   2. Title heuristic prune (shorts + blocklist) — no videos.list yet
 *   3. Exclude policy applied BEFORE LLM (cheaper than after)
 *   4. Chunk → N parallel LLM picker calls (default Haiku via OpenRouter)
 *   5. Score-sort + dedup picks
 *   6. videos.list ONCE for the picked set → full stats / duration
 *   7. Assemble AddCardCandidate[] with score + reason
 *
 * Latency target: 12s hard cap (see config.ts comment).
 */

import { logger } from '@/utils/logger';
import { videosBatchFullMetadata, resolveSearchApiKeys } from '../v2/youtube-client';
import type { YouTubeVideoFullMetadata } from '../v2/youtube-client';
import { runYouTubeFanout, type FanoutCandidate } from './youtube-fanout';
import { getV5Config } from './config';
import { getVideoPicker } from '@/modules/llm-picker/registry';
import { getLlmPickerConfig } from '@/config/llm-picker';
import type { PickCandidate, PickResult } from '@/modules/llm-picker/types';

const log = logger.child({ module: 'video-discover/v5/executor' });

export interface V5ExecuteInput {
  centerGoal: string;
  subGoals: string[];
  focusTags: string[];
  targetLevel: string;
  language: 'ko' | 'en';
  excludeVideoIds: Set<string>;
  env: NodeJS.ProcessEnv;
}

export interface V5Card {
  videoId: string;
  title: string;
  channelTitle: string;
  channelId: string;
  thumbnailUrl: string;
  publishedAt: string | null;
  durationSec: number | null;
  viewCount: number | null;
  cellIndex: number | null;
  score: number;
  reason: string;
}

export interface V5ExecuteResult {
  cards: V5Card[];
  diagnostics: {
    queriesAttempted: number;
    queriesSucceeded: number;
    rawItemCount: number;
    afterTitleFilter: number;
    afterExcludeFilter: number;
    llmBatches: number;
    picksRaw: number;
    quotaUnitsApprox: number;
    durationMs: number;
    pickerModel: string;
  };
}

export async function runV5Executor(input: V5ExecuteInput): Promise<V5ExecuteResult> {
  const t0 = Date.now();
  const cfg = getV5Config(input.env);
  const pickerCfg = getLlmPickerConfig(input.env);

  // 1. YouTube fanout
  const fanout = await runYouTubeFanout({
    centerGoal: input.centerGoal,
    subGoals: input.subGoals,
    focusTags: input.focusTags,
    targetLevel: input.targetLevel,
    language: input.language,
    env: input.env,
  });
  const afterTitleFilter = fanout.candidates.length;

  // 2. exclude BEFORE LLM (save LLM tokens)
  const survivors = fanout.candidates.filter((c) => !input.excludeVideoIds.has(c.videoId));
  const afterExcludeFilter = survivors.length;

  if (survivors.length === 0) {
    log.info(
      `v5 executor: no candidates after exclude (raw=${fanout.rawItemCount}, title=${afterTitleFilter})`
    );
    return emptyResult({
      fanout,
      afterTitleFilter,
      afterExcludeFilter,
      pickerCfg,
      t0,
    });
  }

  // 3. chunk + parallel LLM picks
  const batches = chunk(survivors, pickerCfg.batchSize);
  const limitedBatches = batches.slice(0, pickerCfg.maxParallel);
  const picker = getVideoPicker();
  const perBatchMaxPicks = Math.max(
    Math.ceil(cfg.targetPicks / Math.max(limitedBatches.length, 1)) + 2,
    6
  );

  const ac = new AbortController();
  const batchTimer = setTimeout(() => ac.abort(), pickerCfg.timeoutMs);
  let pickResults: PickResult[][];
  try {
    pickResults = await Promise.all(
      limitedBatches.map(async (batch) => {
        try {
          return await picker.pick(
            {
              cellTopic: input.centerGoal,
              parentGoal: input.centerGoal,
              subGoals: input.subGoals,
              focusTags: input.focusTags,
              targetLevel: input.targetLevel,
              language: input.language,
              candidates: batch.map(toPickCandidate),
              maxPicks: perBatchMaxPicks,
            },
            ac.signal
          );
        } catch (err) {
          log.warn(`v5 picker batch failed: ${err instanceof Error ? err.message : String(err)}`);
          return [] as PickResult[];
        }
      })
    );
  } finally {
    clearTimeout(batchTimer);
  }

  const picksMerged = mergePicks(pickResults, cfg.targetPicks);

  if (picksMerged.length === 0) {
    log.info(`v5 executor: picker returned 0 (batches=${limitedBatches.length})`);
    return emptyResult({
      fanout,
      afterTitleFilter,
      afterExcludeFilter,
      pickerCfg,
      t0,
      llmBatches: limitedBatches.length,
    });
  }

  // 4. videos.list for picked only (stats + duration)
  const fanoutById = new Map(survivors.map((c) => [c.videoId, c]));
  const pickedIds = picksMerged.map((p) => p.videoId);
  const apiKeys = resolveSearchApiKeys(input.env);
  let fullMeta: YouTubeVideoFullMetadata[] = [];
  if (apiKeys.length > 0) {
    try {
      fullMeta = await videosBatchFullMetadata({ videoIds: pickedIds, apiKey: apiKeys });
    } catch (err) {
      log.warn(
        `v5 videos.list failed (degraded to search-only meta): ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  const metaById = new Map(fullMeta.map((m) => [m.id ?? '', m]));

  // 5. assemble cards in pick order
  const cards: V5Card[] = picksMerged.map((p) => {
    const fan = fanoutById.get(p.videoId);
    const meta = metaById.get(p.videoId);
    return assembleCard(p, fan, meta);
  });

  return {
    cards,
    diagnostics: {
      queriesAttempted: fanout.queriesAttempted,
      queriesSucceeded: fanout.queriesSucceeded,
      rawItemCount: fanout.rawItemCount,
      afterTitleFilter,
      afterExcludeFilter,
      llmBatches: limitedBatches.length,
      picksRaw: pickResults.reduce((acc, b) => acc + b.length, 0),
      quotaUnitsApprox: fanout.quotaUnitsApprox + (pickedIds.length > 0 ? 1 : 0),
      durationMs: Date.now() - t0,
      pickerModel: picker.model,
    },
  };
}

function emptyResult(args: {
  fanout: {
    queriesAttempted: number;
    queriesSucceeded: number;
    rawItemCount: number;
    quotaUnitsApprox: number;
  };
  afterTitleFilter: number;
  afterExcludeFilter: number;
  pickerCfg: ReturnType<typeof getLlmPickerConfig>;
  t0: number;
  llmBatches?: number;
}): V5ExecuteResult {
  return {
    cards: [],
    diagnostics: {
      queriesAttempted: args.fanout.queriesAttempted,
      queriesSucceeded: args.fanout.queriesSucceeded,
      rawItemCount: args.fanout.rawItemCount,
      afterTitleFilter: args.afterTitleFilter,
      afterExcludeFilter: args.afterExcludeFilter,
      llmBatches: args.llmBatches ?? 0,
      picksRaw: 0,
      quotaUnitsApprox: args.fanout.quotaUnitsApprox,
      durationMs: Date.now() - args.t0,
      pickerModel: args.pickerCfg.model,
    },
  };
}

function toPickCandidate(c: FanoutCandidate): PickCandidate {
  return {
    videoId: c.videoId,
    title: c.title,
    description: c.description,
    channelTitle: c.channelTitle,
  };
}

function chunk<T>(arr: T[], size: number): T[][] {
  if (size <= 0) return [arr];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function mergePicks(batches: PickResult[][], targetCount: number): PickResult[] {
  const seen = new Map<string, PickResult>();
  for (const batch of batches) {
    for (const p of batch) {
      const prev = seen.get(p.videoId);
      if (!prev || p.score > prev.score) seen.set(p.videoId, p);
    }
  }
  return Array.from(seen.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, targetCount);
}

function assembleCard(
  pick: PickResult,
  fan: FanoutCandidate | undefined,
  meta: YouTubeVideoFullMetadata | undefined
): V5Card {
  const title = meta?.snippet?.title ?? fan?.title ?? '';
  const channelTitle = meta?.snippet?.channelTitle ?? fan?.channelTitle ?? '';
  const channelId = meta?.snippet?.channelId ?? fan?.channelId ?? '';
  const thumbnailUrl =
    meta?.snippet?.thumbnails?.high?.url ??
    meta?.snippet?.thumbnails?.medium?.url ??
    fan?.thumbnailUrl ??
    '';
  const publishedAt = meta?.snippet?.publishedAt ?? fan?.publishedAt ?? null;
  const durationSec = parseIsoDurationSeconds(meta?.contentDetails?.duration);
  const viewCountStr = meta?.statistics?.viewCount;
  const viewCount = viewCountStr ? Number(viewCountStr) : null;

  return {
    videoId: pick.videoId,
    title,
    channelTitle,
    channelId,
    thumbnailUrl,
    publishedAt,
    durationSec,
    viewCount: Number.isFinite(viewCount) ? viewCount : null,
    cellIndex: fan?.cellIndex ?? null,
    score: pick.score,
    reason: pick.reason,
  };
}

function parseIsoDurationSeconds(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return null;
  const h = m[1] ? parseInt(m[1], 10) : 0;
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const s = m[3] ? parseInt(m[3], 10) : 0;
  return h * 3600 + min * 60 + s;
}
