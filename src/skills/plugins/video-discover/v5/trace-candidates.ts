/**
 * Observability Phase 1 — reconstruct the per-candidate "Card Journey" for one
 * v5 add-cards / wizard request from the arrays the executor already computed.
 *
 * This is PURE reconstruction (set differences over existing arrays): it reads
 * the pipeline's outputs and never influences any drop/pick/place decision. It
 * runs only when SEARCH_TRACE_ENABLED (the caller gates it).
 *
 * Journey covered here (executor stage B + display stage is added by the route):
 *   fanout survivors  →  excluded_owned  →  series_dedup  →  not_picked
 *                     →  picked: PLACED | shorts | slice_overflow
 * Fanout-internal drops (duplicate/blocklist/shorts_title/off_lang) arrive
 * pre-built in `fanoutDropped` (stage A).
 */
import type { FanoutCandidate } from './youtube-fanout';
import type { V5Card } from './executor';
import type {
  SearchTraceCandidateInput,
  CandidateDecision,
  DropReason,
} from '@/modules/search-trace';

export interface BuildV5TraceArgs {
  /** Stage A — fanout-internal drops, already as candidate rows. */
  fanoutDropped: SearchTraceCandidateInput[];
  /** Universe: everything YouTube returned post title/blocklist/off-lang filter. */
  fanoutCandidates: FanoutCandidate[];
  excludeVideoIds: Set<string>;
  /** Post-exclude, pre-diversity survivors. */
  afterExcludeCands: FanoutCandidate[];
  /** Picker input = post-diversity survivors. */
  pickerInput: FanoutCandidate[];
  /** All picked+assembled cards (superset of gatedCards ⊇ finalCards). */
  cards: V5Card[];
  /** Post short-gate. */
  gatedCards: V5Card[];
  /** Post final slice = PLACED. */
  finalCards: V5Card[];
}

function fromFanout(
  c: FanoutCandidate,
  decision: CandidateDecision,
  dropReason: DropReason | null,
  stage: string
): SearchTraceCandidateInput {
  return {
    videoId: c.videoId,
    channelId: c.channelId || null,
    channelTitle: c.channelTitle || null,
    sourceKind: 'live',
    sourceCellIndex: c.cellIndex,
    stageReached: stage,
    decision,
    dropReason,
    publishedAt: c.publishedAt || null,
  };
}

function fromCard(
  c: V5Card,
  decision: CandidateDecision,
  dropReason: DropReason | null,
  stage: string
): SearchTraceCandidateInput {
  return {
    videoId: c.videoId,
    channelId: c.channelId || null,
    channelTitle: c.channelTitle || null,
    sourceKind: 'live',
    sourceCellIndex: c.cellIndex,
    stageReached: stage,
    decision,
    dropReason,
    llmPickScore: c.score,
    llmPickReason: c.reason || null,
    viewCount: c.viewCount,
    durationSec: c.durationSec,
    publishedAt: c.publishedAt,
    finalCellIndex: decision === 'PLACED' ? c.cellIndex : null,
  };
}

/**
 * Reclassify PLACED rows whose videoId is NOT in `keptIds` to DROPPED with the
 * given reason. Pure; returns a new array. Used when a stage DOWNSTREAM of the
 * executor cuts cards the executor had placed (add-cards display filter, wizard
 * inflow-gate) — the executor could not see that stage, so its PLACED rows are
 * corrected here. Observation-only.
 */
export function reclassifyPlacedNotIn(
  rows: SearchTraceCandidateInput[],
  keptIds: Set<string>,
  dropReason: DropReason,
  stage: string
): SearchTraceCandidateInput[] {
  return rows.map((r) =>
    r.decision === 'PLACED' && !keptIds.has(r.videoId)
      ? {
          ...r,
          decision: 'DROPPED' as const,
          dropReason,
          stageReached: stage,
          finalCellIndex: null,
        }
      : r
  );
}

export function buildV5TraceCandidates(a: BuildV5TraceArgs): SearchTraceCandidateInput[] {
  const rows: SearchTraceCandidateInput[] = [...a.fanoutDropped];
  const emitted = new Set<string>(a.fanoutDropped.map((d) => d.videoId));

  // excluded_owned — universe candidates the user already owns.
  for (const c of a.fanoutCandidates) {
    if (a.excludeVideoIds.has(c.videoId) && !emitted.has(c.videoId)) {
      rows.push(fromFanout(c, 'DROPPED', 'excluded_owned', 'exclude'));
      emitted.add(c.videoId);
    }
  }

  // series_dedup — dropped between post-exclude and picker input (softChannelCap
  // only reorders, so a missing member here is a dedupeSeries drop).
  const pickerIds = new Set(a.pickerInput.map((c) => c.videoId));
  for (const c of a.afterExcludeCands) {
    if (!pickerIds.has(c.videoId) && !emitted.has(c.videoId)) {
      rows.push(fromFanout(c, 'DROPPED', 'series_dedup', 'diversity'));
      emitted.add(c.videoId);
    }
  }

  // Picked videos → PLACED / shorts / slice_overflow (cards ⊇ gated ⊇ final).
  const gatedIds = new Set(a.gatedCards.map((c) => c.videoId));
  const finalIds = new Set(a.finalCards.map((c) => c.videoId));
  for (const c of a.cards) {
    if (emitted.has(c.videoId)) continue;
    if (finalIds.has(c.videoId)) rows.push(fromCard(c, 'PLACED', null, 'placed'));
    else if (!gatedIds.has(c.videoId)) rows.push(fromCard(c, 'DROPPED', 'shorts', 'short_gate'));
    else rows.push(fromCard(c, 'DROPPED', 'slice_overflow', 'slice'));
    emitted.add(c.videoId);
  }

  // not_picked — picker input the picker did not select.
  const pickedIds = new Set(a.cards.map((c) => c.videoId));
  for (const c of a.pickerInput) {
    if (!pickedIds.has(c.videoId) && !emitted.has(c.videoId)) {
      rows.push(fromFanout(c, 'DROPPED', 'not_picked', 'picker'));
      emitted.add(c.videoId);
    }
  }

  return rows;
}
