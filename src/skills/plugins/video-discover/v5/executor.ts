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
import { videosBatchFullMetadata, resolveVideosApiKeys } from '../v2/youtube-client';
import type { YouTubeVideoFullMetadata } from '../v2/youtube-client';
import {
  runYouTubeFanout,
  type FanoutCandidate,
  type FanoutPerQuery,
  type PrecomputedQuery,
  type PoolBackfillMeta,
} from './youtube-fanout';
import type { QueryGenMeta } from './llm-query-gen';
import { getV5Config } from './config';
import { dedupeSeries, softChannelCap } from '../diversity-guard';
import { loadDiversityGuardConfig } from '@/config/diversity-guard';
import { getVideoPicker } from '@/modules/llm-picker/registry';
import { getLlmPickerConfig } from '@/config/llm-picker';
import { isShortCached, SHORT_MAX_DURATION_SEC } from '@/modules/video-pool/is-short';
import { reusePickedToPool } from '@/modules/video-pool/reuse-from-v5';
import type { PickCandidate, PickResult } from '@/modules/llm-picker/types';
import { config } from '@/config/index';
import { buildV5TraceCandidates } from './trace-candidates';
import type { SearchTraceCandidateInput } from '@/modules/search-trace';

const log = logger.child({ module: 'video-discover/v5/executor' });

export interface V5ExecuteInput {
  centerGoal: string;
  subGoals: string[];
  focusTags: string[];
  targetLevel: string;
  language: 'ko' | 'en';
  /** CP499+ '영문 카드 포함' toggle — forwarded to fanout. See FanoutInput. */
  includeEnCards?: boolean;
  excludeVideoIds: Set<string>;
  env: NodeJS.ProcessEnv;
  /**
   * CP491 ROI1 — ISO date passed to YouTube search.list (publishedAfter) so
   * date-filtered candidates are fetched at SEARCH stage, not fetched-then-
   * discarded post-pick. Undefined = no date filter (unchanged behavior).
   */
  publishedAfter?: string;
  /**
   * CP493 — merged-gen per-cell queries (full coverage). When present, fanout
   * uses them verbatim and skips its own query-gen. Undefined = legacy.
   */
  precomputedQueries?: PrecomputedQuery[];
  /**
   * CP494 ④-1 — cellIndices already filled (≥ threshold) → fanout skips them
   * (pool + live). Computed by the caller (add-cards). Undefined = search all.
   */
  fullCellIndices?: number[];
}

export interface V5Card {
  videoId: string;
  title: string;
  channelTitle: string;
  channelId: string;
  thumbnailUrl: string;
  publishedAt: string | null;
  /** D-01 — videos.list snippet.defaultAudioLanguage (free field on the existing 1u call). */
  audioLanguage: string | null;
  durationSec: number | null;
  viewCount: number | null;
  cellIndex: number | null;
  score: number;
  reason: string;
}

/**
 * Per-stage wall-clock breakdown (ms) of a single executor run. CP491 F5 —
 * the executor was previously a black box (only total durationMs), so the
 * "videos.list dominant" claim was elimination-inferred, not measured. These
 * markers make the dominant stage directly observable in prod traces.
 */
export interface V5StageMs {
  fanoutMs: number;
  excludeMs: number;
  llmMs: number;
  videosMs: number;
  assembleMs: number;
  /** CP491 — short-gate probe phase (bounded by V5_SHORT_PROBE_DEADLINE_MS). */
  shortMs: number;
  /** CP492 Track-1 — query generation, split out of fanoutMs (which is now search-only). */
  queryGenMs: number;
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
    /** CP491 F5 — per-stage ms. Stages not reached on an early return are 0. */
    stageMs: V5StageMs;
    /** CP491 F5 — batches that returned [] due to the 5s external abort (U2). */
    abortedBatches: number;
    /** CP491 F5 — whether the picker batchTimer fired (ac.signal.aborted). */
    pickerTimedOut: boolean;
    /** CP491 F5c — per-query raw count + q_ok (from fanout). */
    perQuery: FanoutPerQuery[];
    /** CP491 — Shorts dropped by the post-pick short gate. */
    shortsDropped: number;
    trustDropped: number;
    channelBlockedDropped: number;
    /** CP492 Track-1 — query-gen telemetry (mode/model/latency/llmCells/fellBack). */
    queryGen: QueryGenMeta;
    /** CP492 2차 gate — candidates dropped by the off-language script filter. */
    offLangDropped: number;
    /** CP494 — pool-first backfill telemetry (quota delta + Fork-2 quality surface). */
    poolBackfill: PoolBackfillMeta;
    /** CP494 ④-1 — # cell queries skipped (cell already full). */
    skippedFullCells: number;
    /** CP499+ EN query pass observability. */
    enPass: import('./youtube-fanout').EnPassMeta;
    /** Observability Phase 1 — per-candidate Card Journey rows (flag-gated). */
    traceCandidates?: SearchTraceCandidateInput[];
  };
}

export async function runV5Executor(input: V5ExecuteInput): Promise<V5ExecuteResult> {
  const t0 = Date.now();
  const cfg = getV5Config(input.env);
  const pickerCfg = getLlmPickerConfig(input.env);

  // CP491 F5 — per-stage wall-clock markers (stages not reached stay 0).
  const stage: V5StageMs = {
    fanoutMs: 0,
    excludeMs: 0,
    llmMs: 0,
    videosMs: 0,
    assembleMs: 0,
    shortMs: 0,
    queryGenMs: 0,
  };
  let abortedBatches = 0;
  let pickerTimedOut = false;

  // 1. YouTube fanout
  const tFanout0 = Date.now();
  const fanout = await runYouTubeFanout({
    centerGoal: input.centerGoal,
    subGoals: input.subGoals,
    focusTags: input.focusTags,
    targetLevel: input.targetLevel,
    language: input.language,
    includeEnCards: input.includeEnCards,
    env: input.env,
    publishedAfter: input.publishedAfter,
    precomputedQueries: input.precomputedQueries,
    fullCellIndices: input.fullCellIndices,
  });
  // CP492 Track-1 — split query-gen out of fanout. fanoutMs is now search-only.
  // `?? 0` guards older/mocked FanoutResults that predate the queryGenMs field.
  stage.queryGenMs = fanout.queryGenMs ?? 0;
  stage.fanoutMs = Date.now() - tFanout0 - (fanout.queryGenMs ?? 0);
  const afterTitleFilter = fanout.candidates.length;

  // 2. exclude BEFORE LLM (save LLM tokens)
  const tExclude0 = Date.now();
  let survivors = fanout.candidates.filter((c) => !input.excludeVideoIds.has(c.videoId));
  const afterExcludeFilter = survivors.length;
  // Observation-only: hold the post-exclude array before the diversity guard
  // reassigns `survivors`, so the trace can attribute series-dedup drops.
  const afterExcludeCands = survivors;
  stage.excludeMs = Date.now() - tExclude0;

  // 2.5 CP500+ diversity guard (UX 원칙 2 다양성 축) — same-channel series
  // episodes collapse to the latest one, then the cap-th+ card per channel is
  // DEMOTED within its cell bucket (soft — a thin-supply single-channel cell
  // keeps everything). Runs before the picker so BOTH picker modes consume the
  // diversified order. Flag-gated; unset = 기존 동작.
  const diversity = loadDiversityGuardConfig(input.env);
  if (diversity.enabled && survivors.length > 0) {
    const d = dedupeSeries(survivors, { simThreshold: diversity.seriesSim });
    survivors = softChannelCap(d.kept, diversity.channelSoftCap);
    if (d.dropped > 0) {
      log.info(`v5 diversity guard: series-dedup dropped ${d.dropped}/${afterExcludeFilter}`);
    }
  }

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
      stage,
      abortedBatches,
      pickerTimedOut,
    });
  }

  // 3. pick — LLM curation (default) or cell-binning (V5_PICKER_MODE).
  // cell_binning skips the LLM entirely: it bins fanout survivors by their
  // source query's cellIndex and round-robins the top YouTube-relevance items
  // across the cells, so the downstream targetPicks slice stays cell-balanced.
  // Goal: discover ~1s (no LLM) + 9-cell balance the LLM picker cannot give
  // (it optimizes relevance only → clusters in the core cell). Whether the LLM
  // picker's garbage-filtering is worth keeping is the A/B this flag answers.
  const tLlm0 = Date.now();
  let picksMerged: PickResult[];
  let llmBatchesCount = 0;
  let picksRawCount = 0;
  let pickerModelStr = 'cell_binning';

  if (cfg.pickerMode === 'cell_binning') {
    picksMerged = binByCells(survivors, cfg.targetPicks, cfg.shortOverpickFactor);
    picksRawCount = picksMerged.length;
    stage.llmMs = Date.now() - tLlm0; // ~0 — no network call
  } else {
    // chunk + parallel LLM picks
    const batches = chunk(survivors, pickerCfg.batchSize);
    const limitedBatches = batches.slice(0, pickerCfg.maxParallel);
    const picker = getVideoPicker();
    pickerModelStr = picker.model;
    // CP491 short gate — keep a buffer for dropping Shorts via mergePicks(overpick)
    // below (free: just a wider slice of picks the LLM already produced). Per-batch
    // maxPicks stays sized to targetPicks: sizing it to `overpick` made the LLM
    // generate far more per batch → llmMs 67s → 68s timeout (CP491 regression).
    // Do NOT raise this to overpick (the over-pick trap). Buffer = natural surplus.
    const overpick = Math.ceil(cfg.targetPicks * cfg.shortOverpickFactor);
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
            const msg = err instanceof Error ? err.message : String(err);
            // CP491 F5 — distinguish abort-induced empty picks (U2) from other failures.
            if (msg.includes('cancelled by external signal')) abortedBatches += 1;
            log.warn(`v5 picker batch failed: ${msg}`);
            return [] as PickResult[];
          }
        })
      );
    } finally {
      clearTimeout(batchTimer);
    }
    stage.llmMs = Date.now() - tLlm0;
    pickerTimedOut = ac.signal.aborted;
    picksMerged = mergePicks(pickResults, overpick);
    llmBatchesCount = limitedBatches.length;
    picksRawCount = pickResults.reduce((acc, b) => acc + b.length, 0);
  }

  if (picksMerged.length === 0) {
    log.info(`v5 executor: picker returned 0 (batches=${llmBatchesCount})`);
    return emptyResult({
      fanout,
      afterTitleFilter,
      afterExcludeFilter,
      pickerCfg,
      t0,
      llmBatches: llmBatchesCount,
      stage,
      abortedBatches,
      pickerTimedOut,
    });
  }

  // 4. videos.list for picked only (stats + duration)
  const tVideos0 = Date.now();
  const fanoutById = new Map(survivors.map((c) => [c.videoId, c]));
  const pickedIds = picksMerged.map((p) => p.videoId);
  const apiKeys = resolveVideosApiKeys(input.env);
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
  stage.videosMs = Date.now() - tVideos0;

  // 5. assemble cards in pick order
  const tAssemble0 = Date.now();
  const cards: V5Card[] = picksMerged.map((p) => {
    const fan = fanoutById.get(p.videoId);
    const meta = metaById.get(p.videoId);
    return assembleCard(p, fan, meta);
  });
  stage.assembleMs = Date.now() - tAssemble0;

  // 6. Short gate (CP491) — drop YouTube Shorts. Probe only <180s cards
  // (YouTube cap; >=180s short-circuits with no HTTP). A single shared
  // AbortController deadline bounds TOTAL wall-clock regardless of probe
  // count/waves; probes still in-flight at the deadline fail open (kept).
  // 6a-pre. Channel blocklist (P0 scam-inflow 2026-07-03): impersonation
  // channels are barred from every discovery surface — filtered before the
  // shorts probe so blocked channels never consume probe budget.
  const { filterBlockedChannels } = await import('@/modules/moderation/channel-blocklist');
  const chFiltered = await filterBlockedChannels(cards, (c) => ({
    channelId: c.channelId,
    channelName: c.channelTitle,
  }));
  const channelBlockedDropped = chFiltered.blockedCount;
  const allowedCards = chFiltered.kept;

  const tShort0 = Date.now();
  let shortsDropped = 0;
  let gatedCards = allowedCards;
  if (cfg.shortProbeDeadlineMs > 0 && allowedCards.length > 0) {
    const shortCtl = new AbortController();
    const shortTimer = setTimeout(() => shortCtl.abort(), cfg.shortProbeDeadlineMs);
    try {
      const shortFlags = await Promise.all(
        allowedCards.map(async (c) => {
          if (c.durationSec != null && c.durationSec >= SHORT_MAX_DURATION_SEC) return false;
          // E-final (CP500+) — known sub-180s dropped on inflow without probing;
          // learning content under 3 min lacks depth. Only unknown duration probes.
          if (c.durationSec != null && c.durationSec < SHORT_MAX_DURATION_SEC) return true;
          const { isShort } = await isShortCached(c.videoId, c.durationSec, {
            signal: shortCtl.signal,
          });
          return isShort;
        })
      );
      gatedCards = allowedCards.filter((_, i) => !shortFlags[i]);
      shortsDropped = allowedCards.length - gatedCards.length;
    } finally {
      clearTimeout(shortTimer);
    }
  }
  stage.shortMs = Date.now() - tShort0;

  // 6b. P0 trust gate (scam-inflow, 2026-07-03): a 5-view impersonation channel
  // reached the add-cards candidate list because the live path had NO view
  // floor. Fail-closed: unknown view count cannot prove trustworthiness.
  let trustDropped = 0;
  if (cfg.liveViewFloor > 0) {
    const beforeTrust = gatedCards.length;
    gatedCards = gatedCards.filter((c) => c.viewCount != null && c.viewCount >= cfg.liveViewFloor);
    trustDropped = beforeTrust - gatedCards.length;
  }

  // 7. Final slice to targetPicks (cards are score-sorted; filter preserved order).
  const finalCards = gatedCards.slice(0, cfg.targetPicks);

  // CP494 ③ reuse loop (keystone) — return picked live discoveries to video_pool
  // so the next request's pool-first match reuses them (user↑ ≠ API↑). Fire-and-
  // forget: NEVER awaited → zero hot-path impact (12s add-cards cap). flag-gated;
  // off = write 0 (current behavior). Consumer reads 'user_live' only when on.
  if (cfg.reuseLoop && finalCards.length > 0) {
    void reusePickedToPool({
      cards: finalCards,
      fanoutById,
      metaById,
      language: input.language,
    }).catch((e) => log.warn(`reuse-loop failed: ${e instanceof Error ? e.message : String(e)}`));
  }

  // Observation-only (SEARCH_TRACE_ENABLED) — reconstruct the per-candidate
  // journey from the arrays computed above. Pure reads; no decision changed.
  const traceCandidates = config.searchTrace.enabled
    ? buildV5TraceCandidates({
        fanoutDropped: fanout.droppedCandidates ?? [],
        fanoutCandidates: fanout.candidates,
        excludeVideoIds: input.excludeVideoIds,
        afterExcludeCands,
        pickerInput: survivors,
        cards,
        gatedCards,
        finalCards,
      })
    : undefined;

  return {
    cards: finalCards,
    diagnostics: {
      queriesAttempted: fanout.queriesAttempted,
      queriesSucceeded: fanout.queriesSucceeded,
      rawItemCount: fanout.rawItemCount,
      afterTitleFilter,
      afterExcludeFilter,
      llmBatches: llmBatchesCount,
      picksRaw: picksRawCount,
      quotaUnitsApprox: fanout.quotaUnitsApprox + (pickedIds.length > 0 ? 1 : 0),
      durationMs: Date.now() - t0,
      pickerModel: pickerModelStr,
      shortsDropped,
      trustDropped,
      channelBlockedDropped,
      stageMs: stage,
      abortedBatches,
      pickerTimedOut,
      perQuery: fanout.perQuery ?? [],
      queryGen: fanout.queryGen,
      offLangDropped: fanout.offLangDropped ?? 0,
      poolBackfill: fanout.poolBackfill,
      skippedFullCells: fanout.skippedFullCells,
      enPass: fanout.enPass,
      traceCandidates,
    },
  };
}

function emptyResult(args: {
  fanout: {
    queriesAttempted: number;
    queriesSucceeded: number;
    rawItemCount: number;
    quotaUnitsApprox: number;
    perQuery?: FanoutPerQuery[];
    queryGen: QueryGenMeta;
    offLangDropped?: number;
    poolBackfill: PoolBackfillMeta;
    skippedFullCells?: number;
    enPass: import('./youtube-fanout').EnPassMeta;
  };
  afterTitleFilter: number;
  afterExcludeFilter: number;
  pickerCfg: ReturnType<typeof getLlmPickerConfig>;
  t0: number;
  llmBatches?: number;
  stage: V5StageMs;
  abortedBatches: number;
  pickerTimedOut: boolean;
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
      shortsDropped: 0,
      trustDropped: 0,
      channelBlockedDropped: 0,
      stageMs: args.stage,
      abortedBatches: args.abortedBatches,
      pickerTimedOut: args.pickerTimedOut,
      perQuery: args.fanout.perQuery ?? [],
      queryGen: args.fanout.queryGen,
      offLangDropped: args.fanout.offLangDropped ?? 0,
      poolBackfill: args.fanout.poolBackfill,
      skippedFullCells: args.fanout.skippedFullCells ?? 0,
      enPass: args.fanout.enPass,
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

/**
 * cell_binning picker (V5_PICKER_MODE=cell_binning) — no LLM. Bins fanout
 * survivors by their source query's cellIndex and round-robins the top
 * YouTube-relevance items across cells. Round-robin order means the downstream
 * `slice(0, targetPicks)` drops the deepest per-cell rank last, so every cell
 * stays represented (vs the LLM picker clustering all picks in the core cell).
 *
 * survivors preserve search.list relevance order within each cell, so taking
 * index r across cells = the r-th best per cell. Score decreases with rank so
 * the FE's score-desc display sort stays sensible. `reason` is empty (no LLM).
 * overpickFactor widens the slice so the short gate has surplus to drop without
 * unbalancing the final targetPicks.
 */
export function binByCells(
  survivors: FanoutCandidate[],
  targetPicks: number,
  overpickFactor: number
): PickResult[] {
  const byCell = new Map<number, FanoutCandidate[]>();
  for (const c of survivors) {
    const key = c.cellIndex ?? -1; // -1 = center/core (null cellIndex query)
    const bucket = byCell.get(key);
    if (bucket) bucket.push(c);
    else byCell.set(key, [c]);
  }
  const cells = Array.from(byCell.keys()).sort((a, b) => a - b);
  const perCell = Math.ceil((targetPicks * overpickFactor) / Math.max(cells.length, 1));

  // CP500+ PR3 ("상한 → 최소 확보", James spec): the per-cell rank cut used to
  // DISCARD surplus — a starved cell's unused budget was thrown away while a
  // rich cell's rank-(perCell+1) candidate evaporated (the "12 limit" loss in
  // the 2026-06-12 funnel diagnosis). Round-robin now CONTINUES past perCell
  // while the total budget has room, so rich-cell surplus backfills the count.
  // Per-cell MINIMUMS remain pool-serve's job (MIN_PER_CELL refill); the
  // first perCell rounds are byte-identical to the previous output.
  const budget = Math.ceil(targetPicks * overpickFactor);
  const out: PickResult[] = [];
  let r = 0;
  let advanced = true;
  while (out.length < budget && advanced) {
    advanced = false;
    for (const cell of cells) {
      if (out.length >= budget) break;
      const cand = byCell.get(cell)![r];
      if (!cand) continue;
      out.push({
        videoId: cand.videoId,
        score: Math.max(0.01, 1 - r / (perCell + 1)),
        reason: '',
      });
      advanced = true;
    }
    r += 1;
  }
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
  const audioLanguage = meta?.snippet?.defaultAudioLanguage ?? null;
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
    audioLanguage,
    durationSec,
    viewCount: Number.isFinite(viewCount) ? viewCount : null,
    cellIndex: fan?.cellIndex ?? null,
    score: pick.score,
    reason: pick.reason,
  };
}

export function parseIsoDurationSeconds(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return null;
  const h = m[1] ? parseInt(m[1], 10) : 0;
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const s = m[3] ? parseInt(m[3], 10) : 0;
  return h * 3600 + min * 60 + s;
}
