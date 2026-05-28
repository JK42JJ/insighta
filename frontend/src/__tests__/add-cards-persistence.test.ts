/**
 * CP489 Phase 4 — persistence v1→v2 migration tests.
 *
 * Goal: any record written by the previous schema (single `cards` array)
 * MUST load cleanly into the new `rounds` shape — never a cold start that
 * silently drops the user's saved discovery context.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadAddCardsState,
  saveAddCardsState,
  mergeSurfacedVideoIds,
  type AddCardsRound,
} from '../widgets/add-cards-panel/lib/persistence';

const MID = 'mandala-uuid-1';
const KEY = `addCards:state:${MID}`;

function card(videoId: string) {
  return {
    videoId,
    title: `t-${videoId}`,
    channel: null,
    thumbnail: null,
    durationSec: null,
    viewCount: null,
    publishedAt: null,
    score: 0,
    cellIndex: 0,
    source: 'video_pool' as const,
  };
}

describe('addCards persistence — v1 → v2 migration', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('returns null when nothing is stored', () => {
    expect(loadAddCardsState(MID)).toBeNull();
  });

  it('returns null on corrupt JSON', () => {
    window.localStorage.setItem(KEY, '{not json');
    expect(loadAddCardsState(MID)).toBeNull();
  });

  it('returns null when mandalaId in record does not match query', () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({
        version: 2,
        mandalaId: 'OTHER',
        rounds: [],
        surfacedVideoIds: [],
        lastSearchedAt: '',
      })
    );
    expect(loadAddCardsState(MID)).toBeNull();
  });

  it('loads v2 record verbatim (defensive filtering of bad rounds)', () => {
    const goodRound: AddCardsRound = {
      id: 'r1',
      at: '2026-05-28T00:00:00Z',
      cards: [card('vA')],
    };
    window.localStorage.setItem(
      KEY,
      JSON.stringify({
        version: 2,
        mandalaId: MID,
        rounds: [
          goodRound,
          { id: 'bad-no-cards' }, // dropped
          { id: 'r2', at: '2026-05-28T01:00:00Z', cards: [card('vB')] },
        ],
        surfacedVideoIds: ['vA', 'vB'],
        lastSearchedAt: '2026-05-28T01:00:00Z',
      })
    );
    const out = loadAddCardsState(MID);
    expect(out).not.toBeNull();
    expect(out!.version).toBe(2);
    expect(out!.rounds).toHaveLength(2);
    expect(out!.rounds.map((r) => r.id)).toEqual(['r1', 'r2']);
    expect(out!.surfacedVideoIds).toEqual(['vA', 'vB']);
  });

  it('migrates v1 record into a single legacy round', () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({
        version: 1,
        mandalaId: MID,
        cards: [card('vX'), card('vY')],
        surfacedVideoIds: ['vX', 'vY'],
        lastSearchedAt: '2026-05-27T00:00:00Z',
      })
    );
    const out = loadAddCardsState(MID);
    expect(out).not.toBeNull();
    expect(out!.version).toBe(2);
    expect(out!.rounds).toHaveLength(1);
    expect(out!.rounds[0]!.id).toBe('legacy-v1');
    expect(out!.rounds[0]!.at).toBe('2026-05-27T00:00:00Z');
    expect(out!.rounds[0]!.cards.map((c) => c.videoId)).toEqual(['vX', 'vY']);
    expect(out!.surfacedVideoIds).toEqual(['vX', 'vY']);
  });

  it('migrates v1 record with empty cards into empty rounds (not a single empty round)', () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({
        version: 1,
        mandalaId: MID,
        cards: [],
        surfacedVideoIds: ['vA'],
        lastSearchedAt: '',
      })
    );
    const out = loadAddCardsState(MID);
    expect(out).not.toBeNull();
    expect(out!.rounds).toEqual([]);
    expect(out!.surfacedVideoIds).toEqual(['vA']);
  });

  it('save → load roundtrip preserves rounds order (newest first)', () => {
    const rounds: AddCardsRound[] = [
      { id: 'r2', at: '2026-05-28T01:00:00Z', cards: [card('v2')] },
      { id: 'r1', at: '2026-05-28T00:00:00Z', cards: [card('v1')] },
    ];
    saveAddCardsState(MID, rounds, ['v1', 'v2']);
    const out = loadAddCardsState(MID);
    expect(out!.rounds.map((r) => r.id)).toEqual(['r2', 'r1']);
    expect(out!.surfacedVideoIds).toEqual(['v1', 'v2']);
  });

  it('save trims rounds to the cap (keeps newest)', () => {
    const rounds: AddCardsRound[] = Array.from({ length: 15 }, (_, i) => ({
      id: `r${i}`,
      at: `2026-05-28T00:00:${String(i).padStart(2, '0')}Z`,
      cards: [card(`v${i}`)],
    }));
    saveAddCardsState(MID, rounds, []);
    const out = loadAddCardsState(MID);
    expect(out!.rounds).toHaveLength(12);
    // first 12 are the newest (input order is preserved by slice(0, cap))
    expect(out!.rounds.map((r) => r.id)).toEqual(rounds.slice(0, 12).map((r) => r.id));
  });
});

describe('mergeSurfacedVideoIds', () => {
  it('returns the union with insertion order from prev → next', () => {
    expect(mergeSurfacedVideoIds(['a', 'b'], ['b', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('is idempotent', () => {
    expect(mergeSurfacedVideoIds(['a'], ['a'])).toEqual(['a']);
  });

  it('returns empty when both inputs are empty', () => {
    expect(mergeSurfacedVideoIds([], [])).toEqual([]);
  });
});
