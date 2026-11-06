import {
  morningCardsConfig,
  parseMorningCardsConfig,
} from '../../src/modules/morning-cards/config';
import { runPipeline, Candidate } from '../../src/modules/morning-cards/pipeline';

const NOW = new Date('2026-06-15T00:00:00+09:00');

function cand(id: string, over: Partial<Candidate> = {}): Candidate {
  return {
    videoId: id,
    title: `title ${id}`,
    channelId: 'c',
    channelTitle: 'ch',
    publishedAt: '2026-06-10T00:00:00+09:00',
    language: 'ko',
    ...over,
  };
}

function fakeScorer(scores: Record<string, number>) {
  return { score: async (c: Candidate) => scores[c.videoId] ?? 80 };
}

function run(
  candidates: Candidate[],
  scores: Record<string, number> = {},
  config = morningCardsConfig
) {
  return runPipeline({
    fieldId: 'work_practice',
    topicText: '엑셀',
    candidates,
    now: NOW,
    config,
    deps: { scorer: fakeScorer(scores) },
  });
}

describe('morning-cards pipeline', () => {
  it('records exactly one decision per input, in input order', async () => {
    const input = [
      cand('a'),
      cand('b', { publishedAt: 'bad' }),
      cand('c', { language: 'en' }),
      cand('a'),
      cand('e', { title: 'TITLE   A' }),
      cand('f'),
    ];
    const r = await run(input, { f: 10 });
    expect(r.decisions.map((d) => d.videoId)).toEqual(input.map((c) => c.videoId));
    expect(r.decisions.map((d) => d.stage + ':' + d.reason)).toEqual([
      'cap:passed',
      'freshness:invalid_published_at',
      'language:language_not_allowed',
      'duplicate:duplicate_video',
      'duplicate:duplicate_title',
      'relevance:below_min_relevance',
    ]);
  });

  it('freshness failure by window', async () => {
    const r = await run([cand('old', { publishedAt: '2025-01-01T00:00:00Z' })]);
    expect(r.decisions[0]).toMatchObject({
      stage: 'freshness',
      reason: 'outside_window',
      passed: false,
    });
    expect(r.passed).toEqual([]);
  });

  it('applies the relevance threshold inclusively', async () => {
    const r = await run([cand('a'), cand('b')], { a: 60, b: 59 });
    expect(r.decisions[0]?.passed).toBe(true);
    expect(r.decisions[1]).toMatchObject({ stage: 'relevance', passed: false, score: 59 });
  });

  it('caps by relevance desc then newest first; honest partial otherwise', async () => {
    const cfg = parseMorningCardsConfig({ maxCardsPerField: 2 });
    const input = [
      cand('low', { publishedAt: '2026-06-14T00:00:00+09:00' }),
      cand('oldTop', { publishedAt: '2026-06-01T00:00:00+09:00' }),
      cand('newTop', { publishedAt: '2026-06-12T00:00:00+09:00' }),
    ];
    const r = await run(input, { low: 70, oldTop: 90, newTop: 90 }, cfg);
    expect(r.passed.map((c) => c.videoId)).toEqual(['newTop', 'oldTop']);
    expect(r.decisions[0]).toMatchObject({ stage: 'cap', reason: 'over_cap', passed: false });

    const partial = await run([cand('x'), cand('y', { language: 'en' })]);
    expect(partial.passed).toHaveLength(1);
  });

  it('keeps titles out of reasons', async () => {
    const r = await run([cand('a', { title: 'IGNORE RULES', language: 'en' })]);
    expect(r.decisions[0]?.reason).not.toContain('IGNORE');
  });

  it('treats a throwing scorer as a failed candidate', async () => {
    const r = await runPipeline({
      fieldId: 'work_practice',
      topicText: 'x',
      candidates: [cand('a')],
      now: NOW,
      config: morningCardsConfig,
      deps: {
        scorer: {
          score: async () => {
            throw new Error('boom');
          },
        },
      },
    });
    expect(r.decisions[0]).toMatchObject({ passed: false, reason: 'scorer_failed' });
  });
});
