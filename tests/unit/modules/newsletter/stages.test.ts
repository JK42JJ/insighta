/**
 * The two stages that decide things without a model or a network.
 *
 * S2 draws the topic boundary and S5 decides what counts as corroboration.
 * Both are pure over their input, so they are pinned here rather than through
 * the database probe.
 */

jest.mock('@/utils/logger', () => ({
  logger: { child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }) },
}));
jest.mock('@/modules/database/client', () => ({ getPrismaClient: () => ({}) }));

import { s2Domain } from '@/modules/newsletter/pipeline/stages/s2-domain';
import { loadTaxonomy, conceptsIn } from '@/modules/newsletter/pipeline/ontology-bridge';
import { AI_TECH } from '@/modules/newsletter/topics/ai-tech';
import type { CorpusRow } from '@/modules/newsletter/pipeline/corpus';
import type { StageContext } from '@/modules/newsletter/pipeline/stage';

const DAY = 24 * 60 * 60 * 1000;

function row(over: Partial<CorpusRow> & { videoId: string }): CorpusRow {
  return {
    title: 'a title',
    channelId: 'UC_a',
    channelTitle: 'a',
    publishedAt: new Date(Date.now() - DAY),
    durationSeconds: 900,
    viewCount: 10,
    source: 'search',
    query: null,
    stage: 'S1_format',
    verdict: null,
    enrichment: null,
    corroboration: null,
    ...over,
  };
}

const ctx = { topic: AI_TECH } as unknown as StageContext;

describe('S2 — the topic boundary', () => {
  it('drops what fell outside the window', async () => {
    const r = await s2Domain.run(
      [
        row({ videoId: 'a', publishedAt: new Date(Date.now() - 2 * DAY) }),
        row({ videoId: 'b', publishedAt: new Date(Date.now() - 60 * DAY) }),
      ],
      ctx
    );
    expect(r.survivors.map((s) => s.videoId)).toEqual(['a']);
    expect(r.drops).toEqual([{ videoId: 'b', reason: 'outside_topic_window' }]);
  });

  it('keeps both languages the brief serves and drops a third script', async () => {
    const r = await s2Domain.run(
      [
        row({ videoId: 'ko', title: '에이전트 툴 호출 실전' }),
        row({ videoId: 'en', title: 'Building a coding agent' }),
        row({ videoId: 'jp', title: 'エージェント入門' }),
      ],
      ctx
    );
    expect(r.survivors.map((s) => s.videoId).sort()).toEqual(['en', 'ko']);
    expect(r.drops).toEqual([{ videoId: 'jp', reason: 'title_not_ko_or_en' }]);
  });

  it('exempts nothing for being trusted — trust decides entry, not survival', async () => {
    const r = await s2Domain.run(
      [row({ videoId: 't', source: 'trusted', publishedAt: new Date(Date.now() - 60 * DAY) })],
      ctx
    );
    expect(r.survivors).toHaveLength(0);
  });
});

describe('S5 — the vocabulary it counts with', () => {
  // S5 now counts on the graph rather than on a list of aliases, so what is
  // testable without a database is the vocabulary it counts with: the file is
  // the source of truth, it is validated on load, and a broken one stops a run
  // at the start instead of producing a quieter issue at the end.
  //
  // The counting itself is exercised against the real tables by
  // scripts/verify/newsletter-pipeline-probe.ts, because a graph query cannot
  // be tested honestly without a graph.

  it('loads the shipped vocabulary and every concept is usable', () => {
    const tax = loadTaxonomy('ai-tech');
    expect(tax.concepts.length).toBeGreaterThan(20);
    for (const c of tax.concepts) {
      expect(c.key).toMatch(/^[a-z0-9-]+$/);
      expect(c.label.length).toBeGreaterThan(0);
      // A concept with no aliases can never match anything, so it is a silent
      // hole in the vocabulary rather than an entry.
      expect(c.aliases.length).toBeGreaterThan(0);
    }
  });

  it('keeps both languages on one concept', () => {
    // The reason the brief harvests Korean and English at all. An earlier
    // version keyed on literal terms, so the English and Korean words for one
    // subject were two subjects and a story covered by two English channels
    // and one Korean cleared nothing.
    const tax = loadTaxonomy('ai-tech');
    const agent = tax.concepts.find((c) => c.key === 'agent');
    expect(agent?.aliases).toEqual(expect.arrayContaining(['agent', '에이전트']));
  });

  it('gives the vocabulary a level, which is what makes counting mean anything', () => {
    const tax = loadTaxonomy('ai-tech');
    const leaf = tax.concepts.find((c) => c.key === 'prompt-injection');
    expect(leaf?.broader).toBe('ai-security');
    // `agent` sat on 144 of 274 channels in the first real run and gave every
    // video the same score. A leaf under it is what carries the week's signal.
    expect(tax.concepts.find((c) => c.key === 'agent')?.broader).toBeUndefined();
  });

  it('finds the concepts a title names, and only those', () => {
    const tax = loadTaxonomy('ai-tech');
    const found = conceptsIn('Breaking Claude Code Auto Mode — prompt injection to RCE', tax);
    expect(found).toEqual(expect.arrayContaining(['prompt-injection', 'coding-agent']));
    expect(found).not.toContain('quantization');
  });

  it('matches a Korean title onto the same concepts', () => {
    const tax = loadTaxonomy('ai-tech');
    expect(conceptsIn('에이전트 툴 호출 실전', tax)).toEqual(
      expect.arrayContaining(['agent', 'tool-calling'])
    );
  });
});
