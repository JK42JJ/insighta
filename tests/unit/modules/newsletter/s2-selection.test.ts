/**
 * What is worth a person's judgement.
 *
 * The harvest went from 870 videos to 3,645 and the judge is a person, so S2
 * now also removes what is not worth spending judgement on. The thresholds
 * were measured against this week's 1,184 survivors before they shipped: the
 * median video had 68 views, a quarter had 13 or fewer, and one channel had
 * pushed 47 videos into the pool.
 *
 * The property that matters most here is the trusted exemption. Reach is
 * exactly what a good new source lacks, and filtering trusted channels on
 * numbers would remove the densest material in the corpus.
 */

import { s2Domain } from '@/modules/newsletter/pipeline/stages/s2-domain';
import { AI_TECH } from '@/modules/newsletter/topics/ai-tech';
import type { CorpusRow } from '@/modules/newsletter/pipeline/corpus';
import type { StageContext } from '@/modules/newsletter/pipeline';

const DAY = 86_400_000;

function row(over: Partial<CorpusRow> & { videoId: string }): CorpusRow {
  return {
    title: 'An English Title',
    channelId: 'c-default',
    channelTitle: 'Channel',
    publishedAt: new Date(Date.now() - 2 * DAY),
    durationSeconds: 900,
    viewCount: 10_000,
    source: 'search',
    query: 'coding agent',
    stage: 'S1_format',
    verdict: null,
    enrichment: null,
    corroboration: null,
    ...over,
  } as CorpusRow;
}

function ctx(select?: { minViewsPerDay?: number; maxPerChannel?: number }): StageContext {
  return {
    runId: 'r',
    topic: { ...AI_TECH, select },
    judge: { name: 'console', provenance: 'test', judge: async () => [] },
    artifacts: {},
  } as unknown as StageContext;
}

const reasons = (drops: Array<{ videoId: string; reason: string }>, r: string) =>
  drops.filter((d) => d.reason === r).map((d) => d.videoId);

describe('S2 selection', () => {
  it('drops a video nobody is watching', async () => {
    // 60 views over 2 days is 30 a day, under the floor of 50.
    const res = await s2Domain.run(
      [row({ videoId: 'quiet', viewCount: 60 }), row({ videoId: 'loud', viewCount: 10_000 })],
      ctx({ minViewsPerDay: 50 })
    );
    expect(res.survivors.map((s) => s.videoId)).toEqual(['loud']);
    expect(reasons(res.drops, 'below_reach_floor')).toEqual(['quiet']);
  });

  it('judges yesterday against yesterday, not against six days ago', async () => {
    // Both have 120 views. A flat floor would keep them or drop them together;
    // per-day, the one published hours ago is the one with traction.
    const fresh = row({
      videoId: 'fresh',
      viewCount: 120,
      publishedAt: new Date(Date.now() - 0.5 * DAY),
    });
    const stale = row({
      videoId: 'stale',
      viewCount: 120,
      publishedAt: new Date(Date.now() - 6 * DAY),
      channelId: 'c-other',
    });
    const res = await s2Domain.run([fresh, stale], ctx({ minViewsPerDay: 50 }));
    expect(res.survivors.map((s) => s.videoId)).toEqual(['fresh']);
  });

  it('exempts a trusted channel from the floor', async () => {
    // The whole point: an editor decided this channel matters, and a new
    // source's first video has no reach by definition.
    const res = await s2Domain.run(
      [row({ videoId: 'new-source', viewCount: 3, source: 'trusted' })],
      ctx({ minViewsPerDay: 50 })
    );
    expect(res.survivors.map((s) => s.videoId)).toEqual(['new-source']);
    expect(res.drops).toHaveLength(0);
  });

  it('caps one channel and keeps its most-watched', async () => {
    const res = await s2Domain.run(
      [
        row({ videoId: 'a', channelId: 'farm', viewCount: 30_000 }),
        row({ videoId: 'b', channelId: 'farm', viewCount: 20_000 }),
        row({ videoId: 'c', channelId: 'farm', viewCount: 10_000 }),
        row({ videoId: 'd', channelId: 'farm', viewCount: 5_000 }),
      ],
      ctx({ minViewsPerDay: 50, maxPerChannel: 3 })
    );
    expect(res.survivors.map((s) => s.videoId).sort()).toEqual(['a', 'b', 'c']);
    expect(reasons(res.drops, 'channel_quota')).toEqual(['d']);
  });

  it('does not cap a trusted channel', async () => {
    const trusted = ['t1', 't2', 't3', 't4'].map((id) =>
      row({ videoId: id, channelId: 'trusted-ch', source: 'trusted', viewCount: 1 })
    );
    const res = await s2Domain.run(trusted, ctx({ minViewsPerDay: 50, maxPerChannel: 3 }));
    expect(res.survivors).toHaveLength(4);
  });

  it('passes everything through when the topic sets no selection', async () => {
    // Absent is the behaviour before the harvest grew, and it is what keeps
    // this change revertible by configuration rather than by code.
    const res = await s2Domain.run(
      [row({ videoId: 'quiet', viewCount: 1 }), row({ videoId: 'loud', viewCount: 99_999 })],
      ctx(undefined)
    );
    expect(res.survivors).toHaveLength(2);
    expect(res.drops).toHaveLength(0);
  });

  it('still removes what needs no judgement at all', async () => {
    const res = await s2Domain.run(
      [
        row({ videoId: 'old', publishedAt: new Date(Date.now() - 60 * DAY) }),
        row({ videoId: 'thai', title: 'ทดสอบภาษาไทย' }),
      ],
      ctx({ minViewsPerDay: 50 })
    );
    expect(res.survivors).toHaveLength(0);
    expect(reasons(res.drops, 'outside_topic_window')).toEqual(['old']);
    expect(reasons(res.drops, 'title_not_ko_or_en')).toEqual(['thai']);
  });

  it('is turned on for this brief, not merely available', () => {
    // The tests above inject the setting, which proves the mechanism and
    // proves nothing about whether the shipped topic uses it. Deleting the
    // line from ai-tech.ts left all seven of them green.
    expect(AI_TECH.select).toEqual({ minViewsPerDay: 50, maxPerChannel: 3 });
  });

  it('keeps the size of an issue a property of the brief, not of the harvest', () => {
    // Same reason. These decide how much reaches a reader, and the harvest
    // quadrupling must not move them.
    expect(AI_TECH.draft).toEqual({ picks: 7, candidateStories: 14 });
    expect(AI_TECH.bodyChars).toEqual({ min: 6000, max: 16000 });
  });
});
