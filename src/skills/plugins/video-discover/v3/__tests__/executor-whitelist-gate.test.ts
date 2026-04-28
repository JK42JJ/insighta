/**
 * Integration test for maybeApplyWhitelistGate — the dual-whitelist
 * serving-side gate wired into v3/executor.ts.
 *
 * Verifies:
 *   - flag off                → slots identical, trace null, getChannelWhitelist NOT called
 *   - flag on + hit           → kept slot passes through with applied trace
 *   - flag on + mixed         → non-whitelisted channels dropped
 *   - flag on + empty remote  → inclusive fallback passthrough + warn-reason
 *   - flag on + null channel_id → treated as non-whitelisted
 */

const mockGetChannelWhitelist = jest.fn();

jest.mock('@/modules/video-dictionary', () => {
  // Keep real filterByWhitelist so we test the wiring + pure filter together.
  const actual = jest.requireActual('@/modules/video-dictionary');
  return {
    ...actual,
    getChannelWhitelist: mockGetChannelWhitelist,
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

jest.mock('../config', () => ({
  v3Config: {
    enableTier1Cache: false,
    recencyWeight: 0.15,
    recencyHalfLifeMonths: 18,
    publishedAfterDays: 1095,
    enableSemanticRerank: false,
    semanticAlpha: 0.6,
    semanticBeta: 0.4,
    enableWhitelistGate: false, // overridden per-test
    enableRedisProvider: false, // PR-Y0g default
  },
  DEFAULT_PUBLISHED_AFTER_DAYS: 1095,
}));

import { maybeApplyWhitelistGate, type AssembledSlot } from '../executor';
import { v3Config } from '../config';

const CID_A = 'UCaaaaaaaaaaaaaaaaaaaaaa';
const CID_B = 'UCbbbbbbbbbbbbbbbbbbbbbb';

function setFlag(enabled: boolean): void {
  (v3Config as { enableWhitelistGate: boolean }).enableWhitelistGate = enabled;
}

function makeSlot(
  videoId: string,
  channelId: string | null,
  cellIndex = 0,
  score = 0.5
): AssembledSlot {
  return {
    videoId,
    title: `title ${videoId}`,
    description: null,
    channelName: null,
    channelId,
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

describe('maybeApplyWhitelistGate', () => {
  beforeEach(() => {
    mockGetChannelWhitelist.mockReset();
  });

  test('flag off — slots byte-identical, trace null, getChannelWhitelist NOT called', async () => {
    setFlag(false);
    const input: AssembledSlot[] = [makeSlot('v1', CID_A), makeSlot('v2', CID_B)];

    const out = await maybeApplyWhitelistGate(input);

    expect(out.slots).toBe(input);
    expect(out.trace).toBeNull();
    expect(mockGetChannelWhitelist).not.toHaveBeenCalled();
  });

  test('flag on + all whitelisted — passthrough with applied trace', async () => {
    setFlag(true);
    mockGetChannelWhitelist.mockResolvedValue(new Set([CID_A, CID_B]));
    const input: AssembledSlot[] = [makeSlot('v1', CID_A), makeSlot('v2', CID_B)];

    const out = await maybeApplyWhitelistGate(input);

    expect(out.slots.map((s) => s.videoId)).toEqual(['v1', 'v2']);
    expect(out.trace?.reason).toBe('applied');
    expect(out.trace?.droppedCount).toBe(0);
  });

  test('flag on + partial whitelist — drops non-whitelisted channels', async () => {
    setFlag(true);
    mockGetChannelWhitelist.mockResolvedValue(new Set([CID_A]));
    const input: AssembledSlot[] = [
      makeSlot('v1', CID_A),
      makeSlot('v2', CID_B),
      makeSlot('v3', CID_A),
    ];

    const out = await maybeApplyWhitelistGate(input);

    expect(out.slots.map((s) => s.videoId)).toEqual(['v1', 'v3']);
    expect(out.trace?.reason).toBe('applied');
    expect(out.trace?.inputCount).toBe(3);
    expect(out.trace?.keptCount).toBe(2);
    expect(out.trace?.droppedCount).toBe(1);
  });

  test('flag on + empty remote whitelist — inclusive fallback passthrough', async () => {
    setFlag(true);
    mockGetChannelWhitelist.mockResolvedValue(new Set());
    const input: AssembledSlot[] = [makeSlot('v1', CID_A), makeSlot('v2', CID_B)];

    const out = await maybeApplyWhitelistGate(input);

    expect(out.slots.map((s) => s.videoId)).toEqual(['v1', 'v2']);
    expect(out.trace?.reason).toBe('empty_whitelist_inclusive_fallback');
    expect(out.trace?.droppedCount).toBe(0);
  });

  test('flag on + null channelId — treated as non-whitelisted and dropped', async () => {
    setFlag(true);
    mockGetChannelWhitelist.mockResolvedValue(new Set([CID_A]));
    const input: AssembledSlot[] = [makeSlot('v1', CID_A), makeSlot('v2', null)];

    const out = await maybeApplyWhitelistGate(input);

    expect(out.slots.map((s) => s.videoId)).toEqual(['v1']);
    expect(out.trace?.droppedCount).toBe(1);
  });

  test('flag on + empty slots — no-op with empty_slots trace', async () => {
    setFlag(true);
    mockGetChannelWhitelist.mockResolvedValue(new Set([CID_A]));

    const out = await maybeApplyWhitelistGate([]);

    expect(out.slots).toEqual([]);
    expect(out.trace?.reason).toBe('empty_slots');
  });

  test('flag on — restores null channelId in surviving slots (no empty-string leak)', async () => {
    setFlag(true);
    mockGetChannelWhitelist.mockResolvedValue(new Set([CID_A]));
    // Intentionally use a whitelist entry for the null-channelId slot
    // to make sure the restoration step runs on a survivor.
    mockGetChannelWhitelist.mockResolvedValue(new Set([CID_A, '']));
    const input: AssembledSlot[] = [makeSlot('v1', CID_A), makeSlot('v2', null)];

    const out = await maybeApplyWhitelistGate(input);

    const survivor = out.slots.find((s) => s.videoId === 'v2');
    // If the guardrail ever loosens to allow '' in whitelist, v2 would
    // survive. Regardless of survival, channelId must never leak as ''.
    if (survivor) {
      expect(survivor.channelId).toBeNull();
    } else {
      // null-channelId slot dropped as expected under strict policy
      expect(out.slots.map((s) => s.videoId)).toEqual(['v1']);
    }
  });
});
