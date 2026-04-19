/**
 * Integration test for Slice B executor wiring.
 *
 * Verifies maybeApplySemanticRerank:
 *   - flag off   → slots byte-identical, trace null, no getSemanticRank call
 *   - flag on    → getSemanticRank called with cell-targeted assignments,
 *                  slots re-sorted with blended scores, trace populated
 *   - all-null   → passthrough with re-sort (applySemanticRerank semantics)
 */

const mockGetSemanticRank = jest.fn();

jest.mock('@/modules/video-dictionary', () => {
  // Real applySemanticRerank + mocked getSemanticRank — tests the wiring
  // while keeping the blend formula under test coverage too.
  const actual = jest.requireActual('@/modules/video-dictionary');
  return {
    ...actual,
    getSemanticRank: mockGetSemanticRank,
  };
});

jest.mock('@/modules/database', () => ({
  getPrismaClient: () => ({ $queryRaw: jest.fn() }),
}));

jest.mock('@/utils/logger', () => ({
  logger: {
    child: () => ({
      debug: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
    }),
  },
}));

// Config module mocked so we can toggle the flag without touching process.env.
jest.mock('../config', () => ({
  v3Config: {
    enableTier1Cache: false,
    recencyWeight: 0.15,
    recencyHalfLifeMonths: 18,
    publishedAfterDays: 1095,
    enableSemanticRerank: false, // overridden per-test via the helper below
    semanticAlpha: 0.6,
    semanticBeta: 0.4,
  },
  DEFAULT_PUBLISHED_AFTER_DAYS: 1095,
}));

import { maybeApplySemanticRerank, type AssembledSlot } from '../executor';
import { v3Config } from '../config';

function setFlag(enabled: boolean): void {
  (v3Config as { enableSemanticRerank: boolean }).enableSemanticRerank = enabled;
}

function makeSlots(): AssembledSlot[] {
  return [makeSlot('v-a', 0, 0.4), makeSlot('v-b', 0, 0.8), makeSlot('v-c', 1, 0.5)];
}

function makeSlot(videoId: string, cellIndex: number, score: number): AssembledSlot {
  return {
    videoId,
    title: `title ${videoId}`,
    description: null,
    channelName: null,
    thumbnail: null,
    viewCount: null,
    likeCount: null,
    durationSec: null,
    publishedAt: null,
    cellIndex,
    score,
    tier: 'realtime',
  };
}

describe('maybeApplySemanticRerank', () => {
  beforeEach(() => {
    mockGetSemanticRank.mockReset();
  });

  test('flag off — slots byte-identical, trace null, getSemanticRank NOT called', async () => {
    setFlag(false);
    const inputSlots = makeSlots();
    const snapshot = JSON.stringify(inputSlots);

    const out = await maybeApplySemanticRerank(inputSlots, 'm1');

    expect(out.slots).toBe(inputSlots); // same reference
    expect(out.trace).toBeNull();
    expect(mockGetSemanticRank).not.toHaveBeenCalled();
    expect(JSON.stringify(inputSlots)).toBe(snapshot);
  });

  test('flag on + ranks present — getSemanticRank called with cell assignments, slots re-sorted with blend', async () => {
    setFlag(true);
    mockGetSemanticRank.mockResolvedValue(
      new Map([
        ['v-a', 0.9], // blended = 0.6*0.4 + 0.4*0.9 = 0.60
        ['v-b', 0.2], // blended = 0.6*0.8 + 0.4*0.2 = 0.56
        ['v-c', 0.5], // blended = 0.6*0.5 + 0.4*0.5 = 0.50
      ])
    );

    const out = await maybeApplySemanticRerank(makeSlots(), 'm1');

    expect(mockGetSemanticRank).toHaveBeenCalledTimes(1);
    const arg = mockGetSemanticRank.mock.calls[0]![0] as {
      mandalaId: string;
      videoIds: string[];
      cellAssignments: Map<string, number>;
    };
    expect(arg.mandalaId).toBe('m1');
    expect(arg.videoIds).toEqual(['v-a', 'v-b', 'v-c']);
    expect(arg.cellAssignments.get('v-a')).toBe(0);
    expect(arg.cellAssignments.get('v-b')).toBe(0);
    expect(arg.cellAssignments.get('v-c')).toBe(1);

    expect(out.slots.map((s) => s.videoId)).toEqual(['v-a', 'v-b', 'v-c']);
    expect(out.trace).not.toBeNull();
    expect(out.trace!.candidatesIn).toBe(3);
    expect(out.trace!.candidatesScored).toBe(3);
    expect(out.trace!.avgCosine).toBeCloseTo((0.9 + 0.2 + 0.5) / 3, 4);
  });

  test('flag on + all null ranks — slots re-sorted by original score, trace scored=0', async () => {
    setFlag(true);
    mockGetSemanticRank.mockResolvedValue(
      new Map([
        ['v-a', null],
        ['v-b', null],
        ['v-c', null],
      ])
    );

    const out = await maybeApplySemanticRerank(makeSlots(), 'm1');

    // applySemanticRerank always re-sorts (by blended-or-passthrough score desc)
    expect(out.slots.map((s) => s.videoId)).toEqual(['v-b', 'v-c', 'v-a']);
    expect(out.trace).not.toBeNull();
    expect(out.trace!.candidatesScored).toBe(0);
    expect(out.trace!.avgCosine).toBe(0);
  });

  test('flag on + empty slots — returns empty, trace null, no getSemanticRank call', async () => {
    setFlag(true);
    const out = await maybeApplySemanticRerank([], 'm1');
    expect(out.slots).toEqual([]);
    expect(out.trace).toBeNull();
    expect(mockGetSemanticRank).not.toHaveBeenCalled();
  });
});
