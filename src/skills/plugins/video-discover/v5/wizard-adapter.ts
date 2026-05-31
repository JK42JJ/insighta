/**
 * v5 → wizard-precompute adapter.
 *
 * Returns the same `EphemeralDiscoverResult` shape that
 * `runDiscoverEphemeral` (v3) returned, so wizard-precompute / consume /
 * cardPublisher / auto-add code below stays unchanged.
 *
 * Mapping (V5Card → AssembledSlot):
 *   videoId        → videoId
 *   title          → title
 *   channelTitle   → channelName
 *   channelId      → channelId
 *   thumbnailUrl   → thumbnail
 *   durationSec    → durationSec
 *   viewCount      → viewCount
 *   publishedAt    → publishedAt (Date)
 *   cellIndex      → cellIndex (defaults to 0 when v5 has no cell hint)
 *   score          → score
 *   reason         → (dropped — wizard schema has no field for it)
 *   description    → null (v5 doesn't surface description in the final card)
 *   likeCount      → null (v5 skips likeCount fetch to save quota)
 *   tier           → 'realtime' (all v5 cards come from live YouTube fanout)
 */

import type { AssembledSlot, EphemeralDiscoverResult } from '../v3/executor';
import { runV5Executor, type V5ExecuteInput } from './executor';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'video-discover/v5/wizard-adapter' });

export type V5WizardInput = Omit<V5ExecuteInput, 'excludeVideoIds'> & {
  excludeVideoIds?: Set<string>;
};

export async function runV5ForWizard(input: V5WizardInput): Promise<EphemeralDiscoverResult> {
  const t0 = Date.now();
  const result = await runV5Executor({
    centerGoal: input.centerGoal,
    subGoals: input.subGoals,
    focusTags: input.focusTags,
    targetLevel: input.targetLevel,
    language: input.language,
    excludeVideoIds: input.excludeVideoIds ?? new Set<string>(),
    env: input.env,
  });

  // CP491 F5 — surface the per-stage breakdown for the wizard path too
  // (same runV5Executor as /add-cards, C8). Lets prod logs show whether
  // videos.list dominates the wizard discover_ms without a separate trace.
  const s = result.diagnostics.stageMs;
  log.info(
    `v5 wizard stages ms: fanout=${s.fanoutMs} exclude=${s.excludeMs} llm=${s.llmMs} ` +
      `videos=${s.videosMs} assemble=${s.assembleMs} total=${result.diagnostics.durationMs} ` +
      `abortedBatches=${result.diagnostics.abortedBatches} pickerTimedOut=${result.diagnostics.pickerTimedOut}`
  );

  const slots: AssembledSlot[] = result.cards.map((c) => ({
    videoId: c.videoId,
    title: c.title,
    description: null,
    channelName: c.channelTitle || null,
    channelId: c.channelId || null,
    thumbnail: c.thumbnailUrl || null,
    viewCount: c.viewCount,
    likeCount: null,
    durationSec: c.durationSec,
    publishedAt: c.publishedAt ? new Date(c.publishedAt) : null,
    cellIndex: c.cellIndex ?? 0,
    score: c.score,
    tier: 'realtime',
  }));

  return {
    slots,
    queriesUsed: result.diagnostics.queriesAttempted,
    tier0_matches: 0,
    tier1_matches: 0,
    tier2_matches: result.diagnostics.afterTitleFilter,
    duration_ms: Date.now() - t0,
  };
}
