/**
 * v5 executor smoke — mocked fanout + picker, validates orchestration:
 *   - exclude applied before LLM
 *   - chunk + parallel batches
 *   - merge picks by score, dedupe by videoId
 *   - assemble cards in pick order
 */

import { runV5Executor } from '@/skills/plugins/video-discover/v5/executor';
import { resetV5ConfigForTest } from '@/skills/plugins/video-discover/v5/config';
import { resetLlmPickerConfigForTest } from '@/config/llm-picker';
import { setVideoPickerForTest, resetVideoPickerForTest } from '@/modules/llm-picker/registry';
import type { VideoPicker, PickInput, PickResult } from '@/modules/llm-picker/types';

jest.mock('@/skills/plugins/video-discover/v5/youtube-fanout', () => ({
  runYouTubeFanout: jest.fn(),
}));

jest.mock('@/skills/plugins/video-discover/v2/youtube-client', () => ({
  videosBatchFullMetadata: jest.fn().mockResolvedValue([]),
  resolveSearchApiKeys: jest.fn().mockReturnValue([]),
}));

const { runYouTubeFanout } = jest.requireMock('@/skills/plugins/video-discover/v5/youtube-fanout');

function makeFanoutCandidate(id: string, title = `Title ${id}`) {
  return {
    videoId: id,
    title,
    description: `Desc ${id}`,
    channelTitle: `Channel ${id}`,
    channelId: `CH${id}`,
    publishedAt: '2026-05-01T00:00:00Z',
    thumbnailUrl: `https://thumb/${id}.jpg`,
    cellIndex: 0,
  };
}

class FakePicker implements VideoPicker {
  readonly name = 'fake';
  readonly model = 'fake/test';
  constructor(private readonly impl: (input: PickInput) => PickResult[]) {}
  async pick(input: PickInput): Promise<PickResult[]> {
    return this.impl(input);
  }
}

describe('runV5Executor (orchestration smoke)', () => {
  beforeEach(() => {
    resetV5ConfigForTest();
    resetLlmPickerConfigForTest();
    resetVideoPickerForTest();
    runYouTubeFanout.mockReset();
  });

  afterAll(() => {
    resetVideoPickerForTest();
  });

  test('applies exclude BEFORE LLM (excluded ids never reach picker)', async () => {
    runYouTubeFanout.mockResolvedValue({
      candidates: [makeFanoutCandidate('a'), makeFanoutCandidate('b'), makeFanoutCandidate('c')],
      queriesAttempted: 1,
      queriesSucceeded: 1,
      rawItemCount: 3,
      quotaUnitsApprox: 100,
    });
    const seenInputs: PickInput[] = [];
    setVideoPickerForTest(
      new FakePicker((input) => {
        seenInputs.push(input);
        return input.candidates.map((c, i) => ({
          videoId: c.videoId,
          score: 1 - i * 0.1,
          reason: 'ok',
        }));
      })
    );

    await runV5Executor({
      centerGoal: 'goal',
      subGoals: [],
      focusTags: [],
      targetLevel: 'standard',
      language: 'en',
      excludeVideoIds: new Set(['b']),
      env: {} as NodeJS.ProcessEnv,
    });

    expect(seenInputs).toHaveLength(1);
    const passed = seenInputs[0]!.candidates.map((c) => c.videoId);
    expect(passed).toEqual(['a', 'c']);
  });

  test('merges picks across batches and sorts by score desc', async () => {
    runYouTubeFanout.mockResolvedValue({
      candidates: Array.from({ length: 24 }, (_, i) => makeFanoutCandidate(`v${i}`)),
      queriesAttempted: 1,
      queriesSucceeded: 1,
      rawItemCount: 24,
      quotaUnitsApprox: 100,
    });
    setVideoPickerForTest(
      new FakePicker((input) => {
        // each batch picks the first 4 with descending scores
        return input.candidates.slice(0, 4).map((c, i) => ({
          videoId: c.videoId,
          score: 0.95 - i * 0.05,
          reason: 'pick',
        }));
      })
    );

    const result = await runV5Executor({
      centerGoal: 'goal',
      subGoals: [],
      focusTags: [],
      targetLevel: 'standard',
      language: 'en',
      excludeVideoIds: new Set(),
      env: {} as NodeJS.ProcessEnv,
    });

    expect(result.cards.length).toBeGreaterThan(0);
    const scores = result.cards.map((c) => c.score);
    const sorted = [...scores].sort((a, b) => b - a);
    expect(scores).toEqual(sorted);
    const ids = result.cards.map((c) => c.videoId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('returns empty cards when fanout yields nothing', async () => {
    runYouTubeFanout.mockResolvedValue({
      candidates: [],
      queriesAttempted: 0,
      queriesSucceeded: 0,
      rawItemCount: 0,
      quotaUnitsApprox: 0,
    });
    setVideoPickerForTest(new FakePicker(() => []));
    const result = await runV5Executor({
      centerGoal: 'goal',
      subGoals: [],
      focusTags: [],
      targetLevel: 'standard',
      language: 'en',
      excludeVideoIds: new Set(),
      env: {} as NodeJS.ProcessEnv,
    });
    expect(result.cards).toEqual([]);
    expect(result.diagnostics.afterExcludeFilter).toBe(0);
  });

  test('continues when one batch picker throws', async () => {
    runYouTubeFanout.mockResolvedValue({
      candidates: Array.from({ length: 24 }, (_, i) => makeFanoutCandidate(`v${i}`)),
      queriesAttempted: 1,
      queriesSucceeded: 1,
      rawItemCount: 24,
      quotaUnitsApprox: 100,
    });
    let callCount = 0;
    setVideoPickerForTest(
      new FakePicker((input) => {
        callCount += 1;
        if (callCount === 2) throw new Error('boom');
        return input.candidates.slice(0, 2).map((c) => ({
          videoId: c.videoId,
          score: 0.8,
          reason: 'ok',
        }));
      })
    );
    const result = await runV5Executor({
      centerGoal: 'goal',
      subGoals: [],
      focusTags: [],
      targetLevel: 'standard',
      language: 'en',
      excludeVideoIds: new Set(),
      env: {} as NodeJS.ProcessEnv,
    });
    expect(result.cards.length).toBeGreaterThan(0);
  });

  // CP491 F5 — instrumentation: per-stage ms + abort observability.
  test('F5: diagnostics expose per-stage ms for all 5 stages', async () => {
    runYouTubeFanout.mockResolvedValue({
      candidates: [makeFanoutCandidate('a'), makeFanoutCandidate('b')],
      queriesAttempted: 1,
      queriesSucceeded: 1,
      rawItemCount: 2,
      quotaUnitsApprox: 100,
    });
    setVideoPickerForTest(
      new FakePicker((input) =>
        input.candidates.map((c) => ({ videoId: c.videoId, score: 0.9, reason: 'ok' }))
      )
    );
    const result = await runV5Executor({
      centerGoal: 'goal',
      subGoals: [],
      focusTags: [],
      targetLevel: 'standard',
      language: 'en',
      excludeVideoIds: new Set(),
      env: {} as NodeJS.ProcessEnv,
    });
    const s = result.diagnostics.stageMs;
    expect(s).toBeDefined();
    for (const k of ['fanoutMs', 'excludeMs', 'llmMs', 'videosMs', 'assembleMs'] as const) {
      expect(typeof s[k]).toBe('number');
      expect(s[k]).toBeGreaterThanOrEqual(0);
    }
    expect(result.diagnostics.pickerTimedOut).toBe(false);
    expect(result.diagnostics.abortedBatches).toBe(0);
  });

  test('F5: abortedBatches counts only external-abort errors, not generic failures', async () => {
    runYouTubeFanout.mockResolvedValue({
      candidates: Array.from({ length: 24 }, (_, i) => makeFanoutCandidate(`v${i}`)),
      queriesAttempted: 1,
      queriesSucceeded: 1,
      rawItemCount: 24,
      quotaUnitsApprox: 100,
    });
    // 24 candidates / batchSize 12 = 2 batches: one external-abort, one generic.
    let callCount = 0;
    setVideoPickerForTest(
      new FakePicker((input) => {
        callCount += 1;
        if (callCount === 1) throw new Error('OpenRouter request cancelled by external signal');
        if (callCount === 2) throw new Error('boom generic');
        return input.candidates
          .slice(0, 2)
          .map((c) => ({ videoId: c.videoId, score: 0.8, reason: 'ok' }));
      })
    );
    const result = await runV5Executor({
      centerGoal: 'goal',
      subGoals: [],
      focusTags: [],
      targetLevel: 'standard',
      language: 'en',
      excludeVideoIds: new Set(),
      env: {} as NodeJS.ProcessEnv,
    });
    // Only the 'cancelled by external signal' batch is counted.
    expect(result.diagnostics.abortedBatches).toBe(1);
  });

  test('F5c: diagnostics pass through fanout perQuery', async () => {
    const perQuery = [
      { query: 'core q', source: 'core', cellIndex: null, rawCount: 4, fulfilled: true },
      { query: 'sub q', source: 'subgoal', cellIndex: 2, rawCount: 0, fulfilled: false },
    ];
    runYouTubeFanout.mockResolvedValue({
      candidates: [makeFanoutCandidate('a')],
      queriesAttempted: 2,
      queriesSucceeded: 1,
      rawItemCount: 4,
      quotaUnitsApprox: 200,
      perQuery,
    });
    setVideoPickerForTest(
      new FakePicker((input) =>
        input.candidates.map((c) => ({ videoId: c.videoId, score: 0.9, reason: 'ok' }))
      )
    );
    const result = await runV5Executor({
      centerGoal: 'goal',
      subGoals: [],
      focusTags: [],
      targetLevel: 'standard',
      language: 'en',
      excludeVideoIds: new Set(),
      env: {} as NodeJS.ProcessEnv,
    });
    expect(result.diagnostics.perQuery).toEqual(perQuery);
  });
});
