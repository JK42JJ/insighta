/**
 * CP489 Phase 6 — Unit tests for buildMandalaSearchJourney.
 *
 * Why: this aggregator is the contract the admin debugging UI + future
 * quality-metrics rollups will both depend on. Locking the round-window
 * attribution + reuse classification with pure inputs makes any
 * subsequent refactor obvious and reviewable in diff.
 */

import {
  buildMandalaSearchJourney,
  type InteractionRow,
  type TraceRow,
} from '../../../src/modules/discover-tracing/search-journey';

const MANDALA = '00000000-0000-0000-0000-0000000000aa';

function trace(
  id: string,
  runId: string,
  ts: string,
  returned: string[],
  step = 'add_cards.end',
  status = 'ok'
): TraceRow {
  return {
    id,
    run_id: runId,
    step,
    status,
    created_at: new Date(ts),
    response: { returned_video_ids: returned, cards_count: returned.length },
  };
}

function interaction(videoId: string, signal: string, ts: string): InteractionRow {
  return { video_id: videoId, signal, created_at: new Date(ts) };
}

describe('buildMandalaSearchJourney', () => {
  const now = new Date('2026-05-28T00:00:00Z');

  it('returns empty journey when there are no round traces', () => {
    const out = buildMandalaSearchJourney({
      mandalaId: MANDALA,
      traces: [],
      interactions: [],
      now,
    });
    expect(out.rounds).toEqual([]);
    expect(out.summary).toEqual({
      total_rounds: 0,
      unique_shown: 0,
      total_picked: 0,
      total_archived: 0,
      total_deleted: 0,
      reuse_rate: 0,
      picked_rate: 0,
    });
  });

  it('numbers rounds 1-based chronologically even when inputs are out of order', () => {
    const traces = [
      trace('t2', 'r2', '2026-05-28T11:00:00Z', ['v3', 'v4']),
      trace('t1', 'r1', '2026-05-28T10:00:00Z', ['v1', 'v2']),
    ];
    const out = buildMandalaSearchJourney({
      mandalaId: MANDALA,
      traces,
      interactions: [],
      now,
    });
    expect(out.rounds.map((r) => r.round)).toEqual([1, 2]);
    expect(out.rounds[0]!.run_id).toBe('r1');
    expect(out.rounds[1]!.run_id).toBe('r2');
  });

  it('classifies returned videoIds as fresh vs reused_from_prior across rounds', () => {
    const traces = [
      trace('t1', 'r1', '2026-05-28T10:00:00Z', ['v1', 'v2']),
      trace('t2', 'r2', '2026-05-28T11:00:00Z', ['v2', 'v3']), // v2 reused
      trace('t3', 'r3', '2026-05-28T12:00:00Z', ['v1', 'v3', 'v4']), // v1,v3 reused
    ];
    const out = buildMandalaSearchJourney({
      mandalaId: MANDALA,
      traces,
      interactions: [],
      now,
    });
    expect(out.rounds[0]!.fresh_video_ids).toEqual(['v1', 'v2']);
    expect(out.rounds[0]!.reused_from_prior).toEqual([]);
    expect(out.rounds[1]!.fresh_video_ids).toEqual(['v3']);
    expect(out.rounds[1]!.reused_from_prior).toEqual(['v2']);
    expect(out.rounds[2]!.fresh_video_ids).toEqual(['v4']);
    expect(out.rounds[2]!.reused_from_prior).toEqual(['v1', 'v3']);
  });

  it('attributes user actions to the correct round window (between this round and next round ts)', () => {
    const traces = [
      trace('t1', 'r1', '2026-05-28T10:00:00Z', ['v1', 'v2']),
      trace('t2', 'r2', '2026-05-28T11:00:00Z', ['v2', 'v3']),
    ];
    const interactions: InteractionRow[] = [
      interaction('v1', 'like', '2026-05-28T10:30:00Z'), // round 1
      interaction('v2', 'archive', '2026-05-28T10:45:00Z'), // round 1 (returned in r1)
      interaction('v3', 'delete', '2026-05-28T11:30:00Z'), // round 2
      interaction('v1', 'like', '2026-05-28T09:00:00Z'), // BEFORE round 1 — ignored
    ];
    const out = buildMandalaSearchJourney({
      mandalaId: MANDALA,
      traces,
      interactions,
      now,
    });
    expect(out.rounds[0]!.picked_after).toEqual(['v1']);
    expect(out.rounds[0]!.archived_after).toEqual(['v2']);
    expect(out.rounds[0]!.deleted_after).toEqual([]);
    expect(out.rounds[1]!.picked_after).toEqual([]);
    expect(out.rounds[1]!.archived_after).toEqual([]);
    expect(out.rounds[1]!.deleted_after).toEqual(['v3']);
  });

  it('skips interactions on videoIds not returned in the matching round', () => {
    const traces = [trace('t1', 'r1', '2026-05-28T10:00:00Z', ['v1'])];
    const interactions: InteractionRow[] = [
      // v9 was never returned to the user via add-cards in this mandala
      interaction('v9', 'like', '2026-05-28T10:30:00Z'),
    ];
    const out = buildMandalaSearchJourney({
      mandalaId: MANDALA,
      traces,
      interactions,
      now,
    });
    expect(out.rounds[0]!.picked_after).toEqual([]);
  });

  it('summary: reuse_rate = totalReused / totalReturned', () => {
    const traces = [
      trace('t1', 'r1', '2026-05-28T10:00:00Z', ['v1', 'v2']), // 2 returned, 0 reused
      trace('t2', 'r2', '2026-05-28T11:00:00Z', ['v1', 'v3']), // 2 returned, 1 reused
    ];
    const out = buildMandalaSearchJourney({
      mandalaId: MANDALA,
      traces,
      interactions: [],
      now,
    });
    expect(out.summary.total_rounds).toBe(2);
    expect(out.summary.unique_shown).toBe(3); // v1, v2, v3
    expect(out.summary.reuse_rate).toBeCloseTo(0.25, 10); // 1 reused / 4 returned
  });

  it('summary: picked_rate = uniquePickedSet / uniqueShown', () => {
    const traces = [
      trace('t1', 'r1', '2026-05-28T10:00:00Z', ['v1', 'v2']),
      trace('t2', 'r2', '2026-05-28T11:00:00Z', ['v3', 'v4']),
    ];
    const interactions: InteractionRow[] = [
      interaction('v1', 'like', '2026-05-28T10:10:00Z'),
      interaction('v3', 'like', '2026-05-28T11:10:00Z'),
    ];
    const out = buildMandalaSearchJourney({
      mandalaId: MANDALA,
      traces,
      interactions,
      now,
    });
    expect(out.summary.unique_shown).toBe(4);
    expect(out.summary.total_picked).toBe(2);
    expect(out.summary.picked_rate).toBeCloseTo(0.5, 10);
  });

  it('ignores trace rows with status != ok and steps != add_cards.end', () => {
    const traces = [
      trace('t1', 'r1', '2026-05-28T10:00:00Z', ['v1'], 'add_cards.start'),
      trace('t2', 'r2', '2026-05-28T11:00:00Z', ['v2'], 'add_cards.end', 'error'),
      trace('t3', 'r3', '2026-05-28T12:00:00Z', ['v3'], 'add_cards.end', 'ok'),
    ];
    const out = buildMandalaSearchJourney({
      mandalaId: MANDALA,
      traces,
      interactions: [],
      now,
    });
    expect(out.rounds).toHaveLength(1);
    expect(out.rounds[0]!.run_id).toBe('r3');
  });

  it('tolerates trace.response without returned_video_ids (legacy rows)', () => {
    const legacy: TraceRow = {
      id: 't1',
      run_id: 'r1',
      step: 'add_cards.end',
      status: 'ok',
      created_at: new Date('2026-05-28T10:00:00Z'),
      response: { cards_count: 5 }, // no returned_video_ids field
    };
    const out = buildMandalaSearchJourney({
      mandalaId: MANDALA,
      traces: [legacy],
      interactions: [],
      now,
    });
    expect(out.rounds[0]!.returned_video_ids).toEqual([]);
    expect(out.summary.unique_shown).toBe(0);
  });
});
