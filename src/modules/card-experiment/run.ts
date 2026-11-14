/**
 * Card-experiment orchestration (dry-run only, no DB writes, no new searches):
 * metadata -> channel blocklist -> relevance -> gates -> per-cell channel cap.
 * All external effects are injectable so tests run pure.
 */

import { CELL_CHANNEL_CAP, RELEVANCE_COSINE_START } from '@/config/card-experiment';
import { filterBlockedChannels } from '@/modules/moderation/channel-blocklist';
import {
  videosBatchFullMetadata,
  type YouTubeVideoFullMetadata,
} from '@/skills/plugins/video-discover/v2/youtube-client';
import { capPerCellChannel, evaluateCandidate } from './gates';
import { buildRelevanceText, relevanceBestCells, type RelevanceDeps } from './relevance';
import {
  FILTER_NAMES,
  type ExperimentItem,
  type ExperimentOutput,
  type ExperimentResult,
  type FilterName,
  type Funnel,
  type FunnelStep,
} from './types';

type PickChannel = (m: YouTubeVideoFullMetadata) => {
  channelId?: string | null;
  channelName?: string | null;
};

export interface RunDeps {
  fetchMetadata?: (videoIds: string[]) => Promise<YouTubeVideoFullMetadata[]>;
  filterBlocked?: (
    items: YouTubeVideoFullMetadata[],
    pick: PickChannel
  ) => Promise<{ kept: YouTubeVideoFullMetadata[]; blockedCount: number }>;
  relevance?: RelevanceDeps;
  now?: () => Date;
}

export interface RunInput {
  items: ExperimentItem[];
  /** {cellLabel: description}; omit to skip the relevance cut. */
  cells?: Record<string, string>;
  /** Required when deps.fetchMetadata is not injected. */
  apiKeys?: string | string[];
  relevanceThreshold?: number;
  channelCap?: number;
  deps?: RunDeps;
}

const pickChannel: PickChannel = (m) => ({
  channelId: m.snippet?.channelId ?? null,
  channelName: m.snippet?.channelTitle ?? null,
});

export async function runCardExperiment(input: RunInput): Promise<ExperimentOutput> {
  const deps = input.deps ?? {};
  const now = (deps.now ?? (() => new Date()))();
  const threshold = input.relevanceThreshold ?? RELEVANCE_COSINE_START;
  const cap = input.channelCap ?? CELL_CHANNEL_CAP;

  const ids = [...new Set(input.items.map((i) => i.videoId))];
  const fetchMetadata =
    deps.fetchMetadata ??
    ((videoIds: string[]) => videosBatchFullMetadata({ videoIds, apiKey: input.apiKeys ?? [] }));
  const metas = await fetchMetadata(ids);
  const byId = new Map<string, YouTubeVideoFullMetadata>();
  for (const m of metas) if (m.id) byId.set(m.id, m);
  const found = [...byId.values()];

  // channel blocklist -> sets (DB lookup lives behind the injected function)
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

  // relevance (skipped when no cells given)
  const cellScores = new Map<string, { cosine: number | null; bestCell: string | null }>();
  if (input.cells && Object.keys(input.cells).length > 0 && found.length > 0) {
    const texts = found.map((m) =>
      buildRelevanceText(m.snippet?.title ?? '', m.snippet?.description)
    );
    const scores = await relevanceBestCells(texts, input.cells, deps.relevance);
    found.forEach((m, i) => {
      if (m.id && scores[i]) cellScores.set(m.id, scores[i]);
    });
  }
  const useRelevance = !!input.cells && Object.keys(input.cells).length > 0 && found.length > 0;

  const results: ExperimentResult[] = input.items.map((item) => {
    const meta = byId.get(item.videoId);
    if (!meta) {
      return {
        videoId: item.videoId,
        cell: item.cell ?? null,
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
    const score = cellScores.get(item.videoId) ?? { cosine: null, bestCell: null };
    const ev = evaluateCandidate(meta, {
      now,
      blockedChannelIds,
      blockedChannelNames,
      relevance: useRelevance ? { cosine: score.cosine, threshold } : undefined,
    });
    return {
      videoId: item.videoId,
      cell: item.cell ?? null,
      found: true,
      pass: ev.pass,
      failures: ev.failures,
      firstFailure: ev.firstFailure,
      margins: ev.margins,
      bestCell: score.bestCell,
      capped: false,
      capFlag: null,
      finalPass: ev.pass,
    };
  });

  // per-(cell, channel) cap over gate-passing candidates only, input order
  const passing = results
    .filter((r) => r.pass)
    .map((r) => ({
      videoId: r.videoId,
      cell: r.cell ?? r.bestCell,
      channelId: byId.get(r.videoId)?.snippet?.channelId ?? null,
      result: r,
    }));
  for (const c of capPerCellChannel(passing, cap)) {
    if (c.capped) {
      c.item.result.capped = true;
      c.item.result.capFlag = c.flag;
      c.item.result.finalPass = false;
    }
  }

  return { results, funnel: buildFunnel(results) };
}

export function buildFunnel(results: ExperimentResult[]): Funnel {
  const foundResults = results.filter((r) => r.found);
  const failedByFilter = Object.fromEntries(FILTER_NAMES.map((n) => [n, 0])) as Record<
    FilterName,
    number
  >;
  const firstFail = Object.fromEntries(FILTER_NAMES.map((n) => [n, 0])) as Record<
    FilterName,
    number
  >;
  for (const r of foundResults) {
    for (const f of r.failures) failedByFilter[f.filter] += 1;
    if (r.firstFailure) firstFail[r.firstFailure.filter] += 1;
  }

  let remaining = foundResults.length;
  const sequential: FunnelStep[] = [];
  for (const name of FILTER_NAMES) {
    remaining -= firstFail[name];
    sequential.push({ filter: name, removed: firstFail[name], remaining });
  }
  const capped = foundResults.filter((r) => r.capped).length;
  remaining -= capped;
  sequential.push({ filter: 'channel_cap', removed: capped, remaining });

  return {
    total: results.length,
    found: foundResults.length,
    notFound: results.length - foundResults.length,
    failedByFilter,
    sequential,
    capped,
    finalPass: remaining,
  };
}
