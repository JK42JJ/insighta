/**
 * Combined per-video recording for the card experiment (SHADOW MODE).
 *
 * For each candidate (track1 = add-cards API result, track2 = re-processed raw
 * ids) this records ONE result: engine-filter trace + sheet assertions +
 * measurement features, and optionally upserts the measurement rows into
 * candidate_features.
 *
 * HARD RULE: comment text is never stored, returned or logged — only counts
 * (commentSignalsForVideo returns counts only).
 */

import { CELL_CHANNEL_CAP, RELEVANCE_COSINE_START } from '@/config/card-experiment';
import { config } from '@/config/index';
import { getPrismaClient } from '@/modules/database';
import {
  computeChannelFeatures,
  commentSignalsForVideo,
  computeReactionFeatures,
  computeVideoFeatures,
  fetchChannelInfo,
  fetchRecentUploadIds,
  fetchRecentUploadStats,
  toRow,
  titleShape,
  type ChannelInfo,
  type ChannelFeatures,
  type CommentSignals,
  type FetchFn,
  type FilterTraceEntry,
  type MeasurementBranch,
  type MeasurementRecord,
  type ReactionFeatures,
  type RecentUploadStats,
  type SourceKind,
  type TitleShape,
  type UnitsUsed,
  type VideoFeatures,
} from '@/modules/measurement';
import { filterBlockedChannels } from '@/modules/moderation/channel-blocklist';
import {
  VIDEOS_LIST_MAX_IDS_PER_CALL,
  videosBatchFullMetadata,
} from '@/skills/plugins/video-discover/v2/youtube-client';
import { logger } from '@/utils/logger';
import { capPerCellChannel, evaluateCandidate, sheetAssertions } from './gates';
import { buildFunnel } from './run';
import { buildRelevanceText, relevanceBestCells, type RelevanceDeps } from './relevance';
import type { ExperimentResult, FilterFailure, Funnel, YouTubeVideoFullMetadata } from './types';

const log = logger.child({ module: 'card-experiment-record' });

/** Parallel channel / comment fetches in flight. */
const RECORD_FETCH_CONCURRENCY = 5;

export interface RecordItem {
  videoId: string;
  /** Feed cell label (key of cellDescriptions). */
  cell: string;
  branch: MeasurementBranch;
  sourceKind: SourceKind;
  keyword?: string;
  discoveryPaths?: number;
  subCell?: string;
}

type PickChannel = (m: YouTubeVideoFullMetadata) => {
  channelId?: string | null;
  channelName?: string | null;
};

export interface RecordDeps {
  fetchMetadata?: (videoIds: string[]) => Promise<YouTubeVideoFullMetadata[]>;
  filterBlocked?: (
    items: YouTubeVideoFullMetadata[],
    pick: PickChannel
  ) => Promise<{ kept: YouTubeVideoFullMetadata[]; blockedCount: number }>;
  relevance?: RelevanceDeps;
  /** fetch used for channels / playlistItems / commentThreads. */
  fetchFn?: FetchFn;
  /** Awaitable writer; returns number of rows written. */
  writer?: (records: readonly MeasurementRecord[]) => Promise<number>;
  /** Override of config.measurementRecord.enabled (tests). */
  measurementEnabled?: boolean;
  now?: () => Date;
}

export interface RecordInput {
  items: RecordItem[];
  runId: string;
  /** feed cell -> descriptions used for relevance (best-of). */
  cellDescriptions: Record<string, string[]>;
  apiKeys?: string | string[];
  relevanceThreshold?: number;
  writeDb?: boolean;
  deps?: RecordDeps;
}

export interface RecordedMeasurement {
  video: VideoFeatures;
  reaction: ReactionFeatures;
  channel: ChannelFeatures | null;
  comment_signals: CommentSignals | null;
  title_shape: TitleShape;
}

export interface RecordedCandidate {
  videoId: string;
  cell: string;
  subCell: string | null;
  branch: MeasurementBranch;
  sourceKind: SourceKind;
  keyword: string | null;
  discoveryPaths: number | null;
  title: string | null;
  channelTitle: string | null;
  channelId: string | null;
  publishedAt: string | null;
  durationSec: number | null;
  gate: {
    pass: boolean;
    finalPass: boolean;
    capped: boolean;
    failures: FilterFailure[];
  };
  sheet: { pass: boolean; failed: string[]; lang_rescue: boolean };
  relevanceCosine: number | null;
  bestDescriptionIndex: number | null;
  measurement: RecordedMeasurement;
}

export interface RecordUnits {
  videos: number;
  channels: number;
  playlistItems: number;
  commentThreads: number;
}

export interface RecordSkipped {
  /** Items whose id was not returned by videos.list (no record). */
  notFound: number;
  /** Distinct channels whose info could not be fetched. */
  channelFetchFailed: number;
  /** Videos with comments disabled. */
  commentsDisabled: number;
}

export interface RecordOutput {
  records: RecordedCandidate[];
  funnel: Funnel;
  units: RecordUnits;
  skipped: RecordSkipped;
  /** Rows handed to the DB writer and written (0 unless writeDb + flag on). */
  written: number;
}

const pickChannel: PickChannel = (m) => ({
  channelId: m.snippet?.channelId ?? null,
  channelName: m.snippet?.channelTitle ?? null,
});

interface ChannelCache {
  info: ChannelInfo;
  recent: RecentUploadStats;
}

/** Run `fn` over `list` with at most `limit` in flight. */
async function mapLimit<T>(
  list: readonly T[],
  limit: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  for (let i = 0; i < list.length; i += limit) {
    await Promise.all(list.slice(i, i + limit).map(fn));
  }
}

/** Default awaitable writer: upsert on (run_id, video_id), swallow row errors. */
export async function writeMeasurementRecordsAwaited(
  records: readonly MeasurementRecord[]
): Promise<number> {
  const prisma = getPrismaClient();
  let written = 0;
  for (const record of records) {
    const { run_id, video_id, ...rest } = toRow(record) as { run_id: string; video_id: string };
    try {
      await prisma.candidate_features.upsert({
        where: { run_id_video_id: { run_id, video_id } },
        create: { run_id, video_id, ...rest } as never,
        update: rest as never,
      });
      written += 1;
    } catch (err) {
      log.debug(`record write failed (swallowed): ${err instanceof Error ? err.message : ''}`);
    }
  }
  return written;
}

export async function recordCandidates(input: RecordInput): Promise<RecordOutput> {
  const deps = input.deps ?? {};
  const now = (deps.now ?? (() => new Date()))();
  const threshold = input.relevanceThreshold ?? RELEVANCE_COSINE_START;
  const keys = Array.isArray(input.apiKeys) ? input.apiKeys : [input.apiKeys ?? ''];
  const apiKey = keys.find((k) => !!k) ?? '';
  const fetchFn: FetchFn = deps.fetchFn ?? ((url: string) => fetch(url));
  const units: UnitsUsed = { channels: 0, playlistItems: 0, videos: 0 };
  let commentThreadUnits = 0;
  const skipped: RecordSkipped = { notFound: 0, channelFetchFailed: 0, commentsDisabled: 0 };

  // ---- 1. metadata (50 ids per videos.list call, 1 unit each)
  const ids = [...new Set(input.items.map((i) => i.videoId))];
  const fetchMetadata =
    deps.fetchMetadata ??
    ((videoIds: string[]) => videosBatchFullMetadata({ videoIds, apiKey: input.apiKeys ?? [] }));
  const metas = ids.length > 0 ? await fetchMetadata(ids) : [];
  units.videos += Math.ceil(ids.length / VIDEOS_LIST_MAX_IDS_PER_CALL);
  const byId = new Map<string, YouTubeVideoFullMetadata>();
  for (const m of metas) if (m.id) byId.set(m.id, m);
  const found = [...byId.values()];

  // ---- 2. channel blocklist
  const filterBlocked = deps.filterBlocked ?? filterBlockedChannels;
  const { kept } = await filterBlocked(found, pickChannel);
  const keptSet = new Set(kept);
  const blockedChannelIds = new Set<string>();
  const blockedChannelNames = new Set<string>();
  for (const m of found) {
    if (keptSet.has(m)) continue;
    const { channelId, channelName } = pickChannel(m);
    if (channelId) blockedChannelIds.add(channelId);
    else if (channelName) blockedChannelNames.add(channelName);
  }

  // ---- 3. relevance per feed cell (best-of over that cell's descriptions)
  const scoreByItem = new Map<RecordItem, { cosine: number | null; bestIdx: number | null }>();
  const itemsByCell = new Map<string, RecordItem[]>();
  for (const item of input.items) {
    if (!byId.has(item.videoId)) continue;
    const descs = input.cellDescriptions[item.cell];
    if (!descs || descs.length === 0) continue;
    const list = itemsByCell.get(item.cell) ?? [];
    list.push(item);
    itemsByCell.set(item.cell, list);
  }
  for (const [cell, cellItems] of itemsByCell) {
    const descs = input.cellDescriptions[cell] ?? [];
    const texts = cellItems.map((it) => {
      const m = byId.get(it.videoId);
      return buildRelevanceText(m?.snippet?.title ?? '', m?.snippet?.description);
    });
    const descMap: Record<string, string> = {};
    descs.forEach((d, i) => {
      descMap[String(i)] = d;
    });
    const scores = await relevanceBestCells(texts, descMap, deps.relevance);
    cellItems.forEach((it, i) => {
      const s = scores[i];
      const idx = s?.bestCell != null ? Number(s.bestCell) : null;
      scoreByItem.set(it, { cosine: s?.cosine ?? null, bestIdx: idx });
    });
  }

  // ---- 4. gates -> ExperimentResult-equivalent (for funnel + cap)
  const results: ExperimentResult[] = input.items.map((item) => {
    const meta = byId.get(item.videoId);
    if (!meta) {
      skipped.notFound += 1;
      return {
        videoId: item.videoId,
        cell: item.cell,
        found: false,
        pass: false,
        failures: [],
        firstFailure: null,
        margins: null,
        bestCell: null,
        capped: false,
        capFlag: null,
        finalPass: false,
      };
    }
    const score = scoreByItem.get(item);
    const ev = evaluateCandidate(meta, {
      now,
      blockedChannelIds,
      blockedChannelNames,
      relevance: score ? { cosine: score.cosine, threshold } : undefined,
    });
    return {
      videoId: item.videoId,
      cell: item.cell,
      found: true,
      pass: ev.pass,
      failures: ev.failures,
      firstFailure: ev.firstFailure,
      margins: ev.margins,
      bestCell: item.cell,
      capped: false,
      capFlag: null,
      finalPass: ev.pass,
    };
  });
  const passing = results
    .filter((r) => r.pass)
    .map((r) => ({
      videoId: r.videoId,
      cell: r.cell,
      channelId: byId.get(r.videoId)?.snippet?.channelId ?? null,
      result: r,
    }));
  for (const c of capPerCellChannel(passing, CELL_CHANNEL_CAP)) {
    if (c.capped) {
      c.item.result.capped = true;
      c.item.result.capFlag = c.flag;
      c.item.result.finalPass = false;
    }
  }

  // ---- 5. channel features, one fetch set per distinct channel
  const channelIds = [
    ...new Set(
      found.map((m) => m.snippet?.channelId).filter((c): c is string => !!c && c.length > 0)
    ),
  ];
  const channelCache = new Map<string, ChannelCache | null>();
  await mapLimit(channelIds, RECORD_FETCH_CONCURRENCY, async (channelId) => {
    const info = await fetchChannelInfo(channelId, apiKey, fetchFn, units);
    if (!info) {
      skipped.channelFetchFailed += 1;
      channelCache.set(channelId, null);
      return;
    }
    const recentIds = info.uploadsPlaylistId
      ? await fetchRecentUploadIds(info.uploadsPlaylistId, apiKey, fetchFn, units)
      : [];
    const recent = await fetchRecentUploadStats(recentIds, apiKey, fetchFn, units);
    channelCache.set(channelId, { info, recent });
  });

  // ---- 6. comment signals, one call per distinct video (counts only)
  const commentCache = new Map<string, CommentSignals>();
  await mapLimit(found, RECORD_FETCH_CONCURRENCY, async (m) => {
    if (!m.id) return;
    commentThreadUnits += 1;
    const signals = await commentSignalsForVideo(m.id, apiKey, fetchFn);
    if (signals.disabled) skipped.commentsDisabled += 1;
    commentCache.set(m.id, signals);
  });

  // ---- 7. assemble
  const records: RecordedCandidate[] = [];
  const measurementRows: MeasurementRecord[] = [];
  input.items.forEach((item, idx) => {
    const meta = byId.get(item.videoId);
    const res = results[idx];
    if (!meta || !res) return;
    const sheet = sheetAssertions(meta);
    const score = scoreByItem.get(item);
    const channelId = meta.snippet?.channelId ?? null;
    const cached = channelId ? channelCache.get(channelId) ?? null : null;
    const reaction = computeReactionFeatures(meta, now);
    const video = computeVideoFeatures(meta, now);
    const channel = cached
      ? computeChannelFeatures(
          {
            subscriberCount: cached.info.subscriberCount,
            hiddenSubscriberCount: cached.info.hiddenSubscriberCount,
            channelPublishedAt: cached.info.channelPublishedAt,
            videoCount: cached.info.videoCount,
            recentPublishedAt: cached.recent.publishedAt,
            recentDurationsSec: cached.recent.durationsSec,
            recentViews: cached.recent.views,
            videoViews: reaction.view_count,
          },
          now
        )
      : null;
    const comments = commentCache.get(item.videoId) ?? null;
    const shape = titleShape(meta.snippet?.title);

    const trace: FilterTraceEntry[] = res.failures.map((f) => ({
      filter: f.filter,
      value: f.value,
      threshold: f.threshold,
    }));
    if (res.capped) {
      trace.push({
        filter: res.capFlag ?? 'channel_cap',
        value: true,
        threshold: CELL_CHANNEL_CAP,
      });
    }

    records.push({
      videoId: item.videoId,
      cell: item.cell,
      subCell: item.subCell ?? null,
      branch: item.branch,
      sourceKind: item.sourceKind,
      keyword: item.keyword ?? null,
      discoveryPaths: item.discoveryPaths ?? null,
      title: meta.snippet?.title ?? null,
      channelTitle: meta.snippet?.channelTitle ?? null,
      channelId,
      publishedAt: meta.snippet?.publishedAt ?? null,
      durationSec: video.duration_sec,
      gate: {
        pass: res.pass,
        finalPass: res.finalPass,
        capped: res.capped,
        failures: res.failures,
      },
      sheet: { pass: sheet.pass, failed: sheet.failed, lang_rescue: sheet.lang_rescue },
      relevanceCosine: score?.cosine ?? null,
      bestDescriptionIndex: score?.bestIdx ?? null,
      measurement: {
        video,
        reaction,
        channel,
        comment_signals: comments,
        title_shape: shape,
      },
    });
    measurementRows.push({
      runId: input.runId,
      branch: item.branch,
      videoId: item.videoId,
      cell: item.cell,
      sourceKind: item.sourceKind,
      keyword: item.keyword ?? null,
      discoveryPaths: item.discoveryPaths ?? null,
      video,
      reaction,
      channel,
      commentSignals: comments,
      filterTrace: trace,
      relevanceScore: score?.cosine ?? null,
    });
  });

  // ---- 8. optional DB write (flag-gated)
  let written = 0;
  const enabled = deps.measurementEnabled ?? config.measurementRecord.enabled;
  if (input.writeDb && enabled && measurementRows.length > 0) {
    const writer = deps.writer ?? writeMeasurementRecordsAwaited;
    written = await writer(measurementRows);
  }

  return {
    records,
    funnel: buildFunnel(results),
    units: {
      videos: units.videos,
      channels: units.channels,
      playlistItems: units.playlistItems,
      commentThreads: commentThreadUnits,
    },
    skipped,
    written,
  };
}
