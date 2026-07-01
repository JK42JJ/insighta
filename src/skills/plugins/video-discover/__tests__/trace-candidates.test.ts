import { buildV5TraceCandidates } from '../v5/trace-candidates';
import type { FanoutCandidate } from '../v5/youtube-fanout';
import type { V5Card } from '../v5/executor';
import type { SearchTraceCandidateInput } from '@/modules/search-trace';

function fc(id: string, cell: number | null = 0): FanoutCandidate {
  return {
    videoId: id,
    title: id,
    description: '',
    channelTitle: `ch-${id}`,
    channelId: `c-${id}`,
    publishedAt: '2026-01-01T00:00:00Z',
    thumbnailUrl: '',
    cellIndex: cell,
  };
}

function card(id: string, cell: number | null = 0, score = 0.5): V5Card {
  return {
    videoId: id,
    title: id,
    channelTitle: `ch-${id}`,
    channelId: `c-${id}`,
    thumbnailUrl: '',
    publishedAt: '2026-01-01T00:00:00Z',
    durationSec: 600,
    viewCount: 5000,
    cellIndex: cell,
    score,
    reason: `reason-${id}`,
  };
}

describe('buildV5TraceCandidates', () => {
  it('reconstructs the full Card Journey with correct decision + drop_reason per stage', () => {
    // universe = v1..v6 (post fanout-internal filter)
    const fanoutCandidates = [fc('v1'), fc('v2'), fc('v3'), fc('v4'), fc('v5'), fc('v6')];
    const excludeVideoIds = new Set(['v6']); // excluded_owned
    const afterExcludeCands = fanoutCandidates.filter((c) => !excludeVideoIds.has(c.videoId));
    const pickerInput = [fc('v1'), fc('v2'), fc('v3'), fc('v4')]; // v5 lost to series_dedup
    const cards = [card('v1'), card('v2'), card('v3')]; // picked (v4 not_picked)
    const gatedCards = [card('v1'), card('v2')]; // v3 dropped by short gate
    const finalCards = [card('v1')]; // v2 = slice_overflow, v1 = PLACED
    const fanoutDropped: SearchTraceCandidateInput[] = [
      { videoId: 'd1', sourceKind: 'live', decision: 'DROPPED', dropReason: 'off_lang' },
    ];

    const rows = buildV5TraceCandidates({
      fanoutDropped,
      fanoutCandidates,
      excludeVideoIds,
      afterExcludeCands,
      pickerInput,
      cards,
      gatedCards,
      finalCards,
    });
    const byId = Object.fromEntries(rows.map((r) => [r.videoId, r]));

    expect(byId['d1']).toMatchObject({ decision: 'DROPPED', dropReason: 'off_lang' }); // A
    expect(byId['v6']).toMatchObject({ decision: 'DROPPED', dropReason: 'excluded_owned' });
    expect(byId['v5']).toMatchObject({ decision: 'DROPPED', dropReason: 'series_dedup' });
    expect(byId['v4']).toMatchObject({ decision: 'DROPPED', dropReason: 'not_picked' });
    expect(byId['v3']).toMatchObject({ decision: 'DROPPED', dropReason: 'shorts' });
    expect(byId['v2']).toMatchObject({ decision: 'DROPPED', dropReason: 'slice_overflow' });
    expect(byId['v1']).toMatchObject({
      decision: 'PLACED',
      dropReason: null,
      finalCellIndex: 0,
      llmPickScore: 0.5,
      llmPickReason: 'reason-v1',
    });

    // No candidate emitted twice; live sync gc/cosine stay null (intentional).
    expect(rows.length).toBe(Object.keys(byId).length);
    expect(byId['v1']!.relevanceGc ?? null).toBeNull();
    expect(byId['v1']!.cosine ?? null).toBeNull();
  });

  it('empty pipeline → only the fanout-internal drops pass through', () => {
    const rows = buildV5TraceCandidates({
      fanoutDropped: [],
      fanoutCandidates: [],
      excludeVideoIds: new Set(),
      afterExcludeCands: [],
      pickerInput: [],
      cards: [],
      gatedCards: [],
      finalCards: [],
    });
    expect(rows).toEqual([]);
  });
});
