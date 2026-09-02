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
import { s5Cross } from '@/modules/newsletter/pipeline/stages/s5-cross';
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

describe('S5 — corroboration', () => {
  const three = [
    row({ videoId: 'a', channelId: 'UC_1', title: 'Building a coding agent with MCP' }),
    row({ videoId: 'b', channelId: 'UC_2', title: 'Agent tool use in production' }),
    row({ videoId: 'c', channelId: 'UC_3', title: '에이전트 툴 호출 실전' }),
  ];

  it('counts a Korean and an English video about one subject as the same subject', async () => {
    // The reason both languages are harvested. Treating them as two subjects
    // means a story covered by two English and one Korean channel clears
    // nothing, and the second language bought nothing.
    const r = await s5Cross.run(three, ctx);
    const first = r.survivors[0]?.corroboration as {
      strongest: string;
      independentChannels: number;
    };
    expect(first.strongest).toBe('agent');
    expect(first.independentChannels).toBe(3);
  });

  it('does not clear a subject two channels covered', async () => {
    const r = await s5Cross.run(three.slice(0, 2), ctx);
    const c = r.survivors[0]?.corroboration as { corroborated: unknown[] };
    expect(c.corroborated).toHaveLength(0);
  });

  it('counts channels, not videos — four uploads from one channel is one source', async () => {
    const r = await s5Cross.run(
      [
        row({ videoId: '1', channelId: 'UC_1', title: 'agent part 1' }),
        row({ videoId: '2', channelId: 'UC_1', title: 'agent part 2' }),
        row({ videoId: '3', channelId: 'UC_1', title: 'agent part 3' }),
        row({ videoId: '4', channelId: 'UC_1', title: 'agent part 4' }),
      ],
      ctx
    );
    const c = r.survivors[0]?.corroboration as { corroborated: unknown[] };
    expect(c.corroborated).toHaveLength(0);
  });

  it('drops nothing — a single-source video can still be the pick of the week', async () => {
    const r = await s5Cross.run(three.slice(0, 1), ctx);
    expect(r.drops).toEqual([]);
    expect(r.survivors).toHaveLength(1);
  });
});
