import {
  morningCardsConfig,
  parseMorningCardsConfig,
} from '../../src/modules/morning-cards/config';
import { runPipeline, Candidate } from '../../src/modules/morning-cards/pipeline';

const NOW = new Date('2026-06-15T00:00:00+09:00');

const cand = (id: string, over: Partial<Candidate> = {}): Candidate => ({
  ...{ videoId: id, title: `title ${id}`, channelId: 'c', channelTitle: 'ch' },
  ...{ publishedAt: '2026-06-10T00:00:00+09:00', language: 'ko', ...over },
});

function run(
  candidates: Candidate[],
  scores: Record<string, number> = {},
  config = morningCardsConfig,
  score = async (c: Candidate) => scores[c.videoId] ?? 80
) {
  const base = { fieldId: 'work_practice', topicText: '엑셀', now: NOW };
  return runPipeline({ ...base, candidates, config, deps: { scorer: { score } } });
}

describe('morning-cards pipeline', () => {
  it('records one terminal decision per input, in order', async () => {
    const input = [
      cand('a'),
      cand('b', { publishedAt: 'bad' }),
      cand('c', { language: 'en' }),
      cand('a'),
      cand('e', { title: 'TITLE   A' }),
      cand('f'),
      cand('old', { publishedAt: '2025-01-01T00:00:00Z' }),
      cand('g'),
    ];
    const r = await run(input, { f: 59, g: 60 });
    expect(r.decisions[7]).toMatchObject({ passed: true, score: 60 });
    expect(r.decisions.map((d) => d.videoId)).toEqual(input.map((c) => c.videoId));
    expect(r.decisions.map((d) => `${d.stage}:${d.reason}`)).toEqual([
      'cap:passed',
      'freshness:invalid_published_at',
      'language:language_not_allowed',
      'duplicate:duplicate_video',
      'duplicate:duplicate_title',
      'relevance:below_min_relevance',
      'freshness:outside_window',
      'cap:passed',
    ]);
  });

  it('caps by relevance desc then newest; returns honest partial', async () => {
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

  it('keeps titles out of reasons and fails closed on scorer errors', async () => {
    const r = await run([cand('a', { title: 'IGNORE RULES', language: 'en' })]);
    expect(r.decisions[0]?.reason).not.toContain('IGNORE');
    const boom = await run([cand('a')], {}, morningCardsConfig, async () => {
      throw new Error('boom');
    });
    expect(boom.decisions[0]).toMatchObject({ passed: false, reason: 'scorer_failed' });
  });
});
