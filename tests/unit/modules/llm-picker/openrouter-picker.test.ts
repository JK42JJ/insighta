/**
 * OpenRouterVideoPicker — JSON parse + invariants.
 *
 * The HTTP transport (OpenRouterGenerationProvider) is mocked. We exercise
 * the picker's prompt-build → JSON-parse → result-validation contract so a
 * future prompt refactor cannot silently break the assemble path.
 */

import { OpenRouterVideoPicker } from '@/modules/llm-picker/openrouter-picker';
import type { PickInput } from '@/modules/llm-picker/types';

jest.mock('@/modules/llm/openrouter', () => {
  return {
    OpenRouterGenerationProvider: jest.fn().mockImplementation(() => ({
      get model() {
        return 'openrouter/anthropic/claude-haiku-4.5';
      },
      generate: jest.fn(),
    })),
  };
});

const { OpenRouterGenerationProvider } = jest.requireMock('@/modules/llm/openrouter');

function makeInput(extra: Partial<PickInput> = {}): PickInput {
  return {
    cellTopic: 'Learn React hooks',
    parentGoal: 'Become a senior frontend engineer',
    subGoals: ['Master TS', 'Master React'],
    focusTags: ['hooks', 'context'],
    targetLevel: 'standard',
    language: 'en',
    candidates: [
      { videoId: 'v1', title: 'useEffect Deep Dive', description: 'desc1', channelTitle: 'C1' },
      { videoId: 'v2', title: 'useState Tutorial', description: 'desc2', channelTitle: 'C2' },
      { videoId: 'v3', title: 'Random Cat Video', description: 'desc3', channelTitle: 'C3' },
    ],
    maxPicks: 2,
    ...extra,
  };
}

describe('OpenRouterVideoPicker', () => {
  let mockGenerate: jest.Mock;

  beforeEach(() => {
    mockGenerate = jest.fn();
    OpenRouterGenerationProvider.mockImplementation(() => ({
      get model() {
        return 'openrouter/anthropic/claude-haiku-4.5';
      },
      generate: mockGenerate,
    }));
  });

  test('parses valid JSON picks and clamps score to [0,1]', async () => {
    mockGenerate.mockResolvedValue(
      JSON.stringify({
        picks: [
          { videoId: 'v1', score: 0.9, reason: 'r1' },
          { videoId: 'v2', score: 1.5, reason: 'r2' },
        ],
      })
    );
    const picker = new OpenRouterVideoPicker();
    const out = await picker.pick(makeInput());
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ videoId: 'v1', score: 0.9, reason: 'r1' });
    expect(out[1]).toEqual({ videoId: 'v2', score: 1, reason: 'r2' });
  });

  test('drops picks whose videoId is not in the input set', async () => {
    mockGenerate.mockResolvedValue(
      JSON.stringify({
        picks: [
          { videoId: 'v1', score: 0.9, reason: 'ok' },
          { videoId: 'BOGUS', score: 0.8, reason: 'hallucinated' },
        ],
      })
    );
    const picker = new OpenRouterVideoPicker();
    const out = await picker.pick(makeInput());
    expect(out.map((p) => p.videoId)).toEqual(['v1']);
  });

  test('dedupes within a single response by videoId', async () => {
    mockGenerate.mockResolvedValue(
      JSON.stringify({
        picks: [
          { videoId: 'v1', score: 0.9, reason: 'first' },
          { videoId: 'v1', score: 0.8, reason: 'second' },
          { videoId: 'v2', score: 0.7, reason: 'ok' },
        ],
      })
    );
    const picker = new OpenRouterVideoPicker();
    const out = await picker.pick(makeInput());
    expect(out.map((p) => p.videoId)).toEqual(['v1', 'v2']);
    expect(out[0]!.reason).toBe('first');
  });

  test('respects maxPicks cap', async () => {
    mockGenerate.mockResolvedValue(
      JSON.stringify({
        picks: [
          { videoId: 'v1', score: 0.9, reason: 'r1' },
          { videoId: 'v2', score: 0.8, reason: 'r2' },
          { videoId: 'v3', score: 0.7, reason: 'r3' },
        ],
      })
    );
    const picker = new OpenRouterVideoPicker();
    const out = await picker.pick(makeInput({ maxPicks: 2 }));
    expect(out).toHaveLength(2);
  });

  test('handles JSON wrapped in markdown code fences', async () => {
    mockGenerate.mockResolvedValue(
      '```json\n{"picks":[{"videoId":"v1","score":0.9,"reason":"ok"}]}\n```'
    );
    const picker = new OpenRouterVideoPicker();
    const out = await picker.pick(makeInput());
    expect(out.map((p) => p.videoId)).toEqual(['v1']);
  });

  test('returns empty array on malformed JSON (no throw)', async () => {
    mockGenerate.mockResolvedValue('not valid json at all');
    const picker = new OpenRouterVideoPicker();
    const out = await picker.pick(makeInput());
    expect(out).toEqual([]);
  });

  test('passes signal through to the underlying provider', async () => {
    mockGenerate.mockResolvedValue(JSON.stringify({ picks: [] }));
    const picker = new OpenRouterVideoPicker();
    const ac = new AbortController();
    await picker.pick(makeInput(), ac.signal);
    expect(mockGenerate).toHaveBeenCalledWith(
      expect.stringContaining('Candidates'),
      expect.objectContaining({ signal: ac.signal, format: 'json' })
    );
  });
});
