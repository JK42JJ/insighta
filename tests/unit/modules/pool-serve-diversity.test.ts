/**
 * pool-serve-fill.ts — applyPoolServeDiversity (global channel hardCap wiring).
 *
 * Measured gap: hardChannelCap (diversity-guard.ts:312, V5_CHANNEL_HARD_CAP)
 * was wired only into v5/executor.ts:219 — pool-serve-fill.ts's applyDiversity
 * only ran dedupeSeries + softChannelCap. This pins the pool-serve wiring at
 * the equivalent position (after softChannelCap), same demote-only semantics
 * as the v5 executor call site.
 */

import {
  applyPoolServeDiversity,
  type GateCandidate,
} from '@/modules/queue/handlers/pool-serve-fill';
import type { DiversityGuardConfig } from '@/config/diversity-guard';

const BASE_CFG: DiversityGuardConfig = {
  enabled: true,
  seriesSim: 0.8,
  channelSoftCap: 2,
  channelHardCap: 0,
  channelHardCapMinCandidates: 3,
  crossChannelDedupEnabled: false,
  crossChannelDedupSim: 0.65,
};

function cand(id: string, channelTitle: string): GateCandidate {
  return {
    youtubeVideoId: id,
    title: `title ${id}`,
    description: null,
    channelTitle,
    thumbnail: null,
    publishedAt: null,
  };
}

describe('applyPoolServeDiversity — diversity.enabled gate', () => {
  it('disabled: same array reference returned (byte-identical no-op)', () => {
    const cfg: DiversityGuardConfig = { ...BASE_CFG, enabled: false, channelHardCap: 5 };
    const input = [cand('v1', 'A')];
    expect(applyPoolServeDiversity(input, [], cfg)).toBe(input);
  });
});

describe('applyPoolServeDiversity — V5_CHANNEL_HARD_CAP=0 (default) is a no-op', () => {
  it('channelHardCap=0: only dedupeSeries + softChannelCap run (existing behavior unchanged)', () => {
    const cfg: DiversityGuardConfig = { ...BASE_CFG, channelHardCap: 0 };
    // 4 distinct-channel candidates — softChannelCap(2) never fires (1 each).
    const input = [cand('v1', 'A'), cand('v2', 'B'), cand('v3', 'C'), cand('v4', 'D')];
    const out = applyPoolServeDiversity(input, [], cfg);
    expect(out.map((c) => c.youtubeVideoId)).toEqual(['v1', 'v2', 'v3', 'v4']); // untouched order
  });
});

describe('applyPoolServeDiversity — hardChannelCap honored (demote-only, count preserved)', () => {
  it('cap=1: the 2nd+ card from one channel is demoted to the tail, never dropped', () => {
    const cfg: DiversityGuardConfig = {
      ...BASE_CFG,
      channelSoftCap: 10, // soft cap high enough it never fires alone
      channelHardCap: 1,
      channelHardCapMinCandidates: 3,
    };
    const input = [cand('v1', 'A'), cand('v2', 'A'), cand('v3', 'B')];
    const out = applyPoolServeDiversity(input, [], cfg);
    expect(out).toHaveLength(3); // never dropped
    expect(out.map((c) => c.youtubeVideoId)).toEqual(['v1', 'v3', 'v2']); // v2 demoted
  });

  it('below channelHardCapMinCandidates: hard cap does not fire (thin-supply protection)', () => {
    const cfg: DiversityGuardConfig = {
      ...BASE_CFG,
      channelSoftCap: 10,
      channelHardCap: 1,
      channelHardCapMinCandidates: 10, // pool below this size
    };
    const input = [cand('v1', 'A'), cand('v2', 'A')];
    const out = applyPoolServeDiversity(input, [], cfg);
    expect(out.map((c) => c.youtubeVideoId)).toEqual(['v1', 'v2']); // untouched
  });
});
