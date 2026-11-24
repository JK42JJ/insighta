/**
 * Card experiment (track 2) — gates, cap, sheet assertions, relevance, runner,
 * and ingest-quality-gate parity. Pure: no DB, no network, no LLM.
 */

import {
  buildFunnel,
  capPerCellChannel,
  evaluateCandidate,
  relevanceScores,
  runCardExperiment,
  sheetAssertions,
  type FilterName,
  type GateContext,
  type YouTubeVideoFullMetadata,
} from '@/modules/card-experiment';
import { applyQualityGate } from '@/modules/video-pool/ingest-quality-gate';

const NOW = new Date('2026-11-09T00:00:00Z');
const CTX: GateContext = { now: NOW };

function iso(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `PT${h}H${m}M${s}S`;
}

interface Over {
  id?: string;
  title?: string;
  description?: string;
  sec?: number;
  embeddable?: boolean | undefined;
  live?: string;
  rating?: Record<string, string>;
  channelId?: string;
  channelTitle?: string;
  audio?: string;
  views?: string;
}

function mk(o: Over = {}): YouTubeVideoFullMetadata {
  return {
    id: o.id ?? 'vid1',
    snippet: {
      title: o.title ?? '파이썬 기초 강의 입문편',
      description: o.description ?? '파이썬 입문 강의입니다',
      channelId: o.channelId ?? 'UC1',
      channelTitle: o.channelTitle ?? '채널1',
      publishedAt: '2026-11-01T00:00:00Z',
      liveBroadcastContent: o.live ?? 'none',
      defaultAudioLanguage: o.audio ?? 'ko',
    },
    contentDetails: {
      duration: iso(o.sec ?? 600),
      ...(o.rating ? { contentRating: o.rating } : {}),
    },
    statistics: { viewCount: o.views ?? '1000' },
    status: { embeddable: 'embeddable' in o ? o.embeddable : true },
  };
}

function failedFilters(m: YouTubeVideoFullMetadata, ctx: GateContext = CTX): FilterName[] {
  return evaluateCandidate(m, ctx).failures.map((f) => f.filter);
}

describe('evaluateCandidate', () => {
  test('clean candidate passes with measured margins', () => {
    const r = evaluateCandidate(mk(), CTX);
    expect(r.pass).toBe(true);
    expect(r.failures).toEqual([]);
    expect(r.firstFailure).toBeNull();
    expect(r.margins.durationSec).toBe(600);
    expect(r.margins.viewCount).toBe(1000);
    expect(r.margins.ageDays).toBeCloseTo(8, 5);
    expect(r.margins.titleLen).toBe('파이썬 기초 강의 입문편'.length);
  });

  test.each([
    [74, ['ingest_quality_gate', 'shorts_duration_75']],
    [75, ['ingest_quality_gate', 'shorts_duration_75']],
    [76, ['ingest_quality_gate']],
    [179, ['ingest_quality_gate']],
    [180, []],
    [181, []],
    [3600, []],
    [3601, ['ingest_quality_gate']],
  ])('duration %ds', (sec, expected) => {
    expect(failedFilters(mk({ sec }))).toEqual(expected);
  });

  test('ingest failure reports reason and threshold', () => {
    const f = evaluateCandidate(mk({ sec: 179 }), CTX).failures[0]!;
    expect(f).toEqual({ filter: 'ingest_quality_gate', value: 'too_short', threshold: 180 });
    const g = evaluateCandidate(mk({ sec: 3601 }), CTX).failures[0]!;
    expect(g).toMatchObject({ value: 'too_long', threshold: 3600 });
  });

  test('shorts duration failure carries threshold 75', () => {
    const f = evaluateCandidate(mk({ sec: 75 }), CTX).failures.find(
      (x) => x.filter === 'shorts_duration_75'
    )!;
    expect(f).toMatchObject({ value: 75, threshold: 75 });
  });

  test('missing duration counts as shorts', () => {
    const m = mk();
    delete m.contentDetails!.duration;
    expect(failedFilters(m)).toContain('shorts_duration_75');
  });

  test('title length boundary 4 / 5', () => {
    expect(failedFilters(mk({ title: '파이썬강' }))).toEqual(['ingest_quality_gate']);
    expect(failedFilters(mk({ title: '파이썬강의' }))).toEqual([]);
  });

  test('ingest blocklist token only (ppl)', () => {
    const r = evaluateCandidate(mk({ title: '파이썬 PPL 강의 모음' }), CTX);
    expect(r.failures).toEqual([
      { filter: 'ingest_quality_gate', value: 'blocklist:ppl', threshold: 'ppl' },
    ]);
  });

  test('token in both lists fails both filters, firstFailure = ingest', () => {
    const r = evaluateCandidate(mk({ title: '광고 없는 파이썬 강의' }), CTX);
    expect(r.failures.map((f) => f.filter)).toEqual(['ingest_quality_gate', 'title_blocklist']);
    expect(r.firstFailure?.filter).toBe('ingest_quality_gate');
  });

  test("'ad' substring hits the v2 title blocklist (engine behavior)", () => {
    expect(failedFilters(mk({ title: 'Reading 파이썬 강의' }))).toEqual(['title_blocklist']);
  });

  test('shorts title marker', () => {
    expect(failedFilters(mk({ title: '파이썬 팁 #shorts 모음' }))).toEqual(['shorts_title']);
    expect(failedFilters(mk({ title: '파이썬 short book 강의' }))).toEqual([]);
  });

  test('Hangul-less Latin title is off-language', () => {
    expect(failedFilters(mk({ title: 'Python tutorial for beginners' }))).toEqual([
      'off_language_title',
    ]);
  });

  test('not embeddable (false and unknown)', () => {
    expect(failedFilters(mk({ embeddable: false }))).toEqual(['not_embeddable']);
    expect(failedFilters(mk({ embeddable: undefined }))).toEqual(['not_embeddable']);
  });

  test('live / upcoming', () => {
    expect(failedFilters(mk({ live: 'live' }))).toEqual(['live_or_upcoming']);
    expect(failedFilters(mk({ live: 'upcoming' }))).toEqual(['live_or_upcoming']);
  });

  test('age restricted', () => {
    expect(failedFilters(mk({ rating: { ytRating: 'ytAgeRestricted' } }))).toEqual([
      'age_restricted',
    ]);
    expect(failedFilters(mk({ rating: { mpaaRating: 'mpaaR' } }))).toEqual([]);
  });

  test('channel blocked by id and by name', () => {
    expect(failedFilters(mk(), { now: NOW, blockedChannelIds: new Set(['UC1']) })).toEqual([
      'channel_blocked',
    ]);
    expect(failedFilters(mk(), { now: NOW, blockedChannelNames: new Set(['채널1']) })).toEqual([
      'channel_blocked',
    ]);
    expect(failedFilters(mk(), { now: NOW, blockedChannelIds: new Set(['UC9']) })).toEqual([]);
  });

  test('relevance cut boundary and null cosine', () => {
    const at = (cosine: number | null): FilterName[] =>
      failedFilters(mk(), { now: NOW, relevance: { cosine, threshold: 0.25 } });
    expect(at(0.24)).toEqual(['relevance_cut']);
    expect(at(0.25)).toEqual([]);
    expect(at(null)).toEqual(['relevance_cut']);
    // omitted relevance -> filter skipped
    expect(failedFilters(mk())).toEqual([]);
  });

  test('evaluates all filters (no early stop)', () => {
    const r = evaluateCandidate(
      mk({ sec: 60, embeddable: false, live: 'live', title: 'Reading python' }),
      CTX
    );
    expect(r.failures.map((f) => f.filter)).toEqual([
      'ingest_quality_gate',
      'shorts_duration_75',
      'title_blocklist',
      'off_language_title',
      'not_embeddable',
      'live_or_upcoming',
    ]);
  });
});

describe('capPerCellChannel', () => {
  const item = (videoId: string, cell: string | null, channelId: string | null) => ({
    videoId,
    cell,
    channelId,
  });

  test('keeps first 2 per (cell, channel) in input order', () => {
    const r = capPerCellChannel([
      item('a', 'c1', 'X'),
      item('b', 'c1', 'X'),
      item('c', 'c1', 'X'),
      item('d', 'c2', 'X'),
      item('e', 'c1', 'Y'),
      item('f', 'c1', 'X'),
    ]);
    expect(r.map((x) => [x.item.videoId, x.capped])).toEqual([
      ['a', false],
      ['b', false],
      ['c', true],
      ['d', false],
      ['e', false],
      ['f', true],
    ]);
    expect(r[2]!.flag).toBe('channel_cap_2_per_cell');
    expect(r[0]!.flag).toBeNull();
  });

  test('custom cap and missing channel id', () => {
    const r = capPerCellChannel([item('a', 'c', 'X'), item('b', 'c', 'X')], 1);
    expect(r.map((x) => x.capped)).toEqual([false, true]);
    const n = capPerCellChannel([item('a', 'c', null), item('b', 'c', null), item('c', 'c', null)]);
    expect(n.every((x) => !x.capped)).toBe(true);
  });
});

describe('sheetAssertions', () => {
  test('duration boundary 239 / 240', () => {
    expect(sheetAssertions(mk({ sec: 239 })).checks.duration).toBe(false);
    expect(sheetAssertions(mk({ sec: 240 })).checks.duration).toBe(true);
  });

  test('missing duration fails', () => {
    const m = mk();
    delete m.contentDetails!.duration;
    expect(sheetAssertions(m).failed).toContain('duration');
  });

  test('shorts tag and embeddable', () => {
    expect(sheetAssertions(mk({ title: '파이썬 #shorts' })).checks.notShorts).toBe(false);
    expect(sheetAssertions(mk({ embeddable: false })).checks.embeddable).toBe(false);
    expect(sheetAssertions(mk()).pass).toBe(true);
  });

  test('ko audio passes language even with Latin title', () => {
    const r = sheetAssertions(mk({ title: 'Python tutorial', description: 'x', audio: 'ko-KR' }));
    expect(r.checks.language).toBe(true);
    expect(r.lang_rescue).toBe(false);
  });

  test('lang_rescue: en audio but Hangul rule passes', () => {
    const r = sheetAssertions(
      mk({ title: '파이썬 입문 Python', description: '파이썬 입문 강의입니다', audio: 'en' })
    );
    expect(r.checks.language).toBe(true);
    expect(r.lang_rescue).toBe(true);
  });

  test('no rescue when Hangul ratio too low or title Hangul too few', () => {
    const lowRatio = sheetAssertions(
      mk({
        title: '파이썬 Python Tutorial Complete Guide',
        description: 'a'.repeat(100),
        audio: 'en',
      })
    );
    expect(lowRatio.checks.language).toBe(false);
    expect(lowRatio.lang_rescue).toBe(false);
    const oneHangul = sheetAssertions(mk({ title: '가 Python', description: '', audio: 'zxx' }));
    expect(oneHangul.checks.language).toBe(false);
  });

  test('description beyond 500 chars is ignored for the ratio', () => {
    const desc = '한'.repeat(10) + 'a'.repeat(490) + '한'.repeat(1000);
    const r = sheetAssertions(mk({ title: '파이썬 입문', description: desc, audio: 'en' }));
    // 5 Hangul (title) + 10 (desc) vs 490 Latin within the window -> ratio < 0.4
    expect(r.checks.language).toBe(false);
  });
});

describe('ingest quality gate parity', () => {
  const v = (title: string, sec: number | null) => ({
    youtube_video_id: 'v',
    title,
    duration_seconds: sec,
  });

  test.each([
    ['파이썬강', 600, 'title_too_short'],
    ['파이썬 협찬 강의', 600, 'blocklist:협찬'],
    ['Sponsored 파이썬 강의', 600, 'blocklist:sponsored'],
    ['파이썬 강의 모음', 179, 'too_short'],
    ['파이썬 강의 모음', 3601, 'too_long'],
  ])('%s / %s -> %s', (title, sec, reason) => {
    expect(applyQualityGate([v(title, sec)]).filtered).toEqual([{ id: 'v', reason }]);
  });

  test('passes boundaries, null duration, trims, dedupes, normalizes source', () => {
    const r = applyQualityGate([
      { ...v('  파이썬 강의 모음  ', 180), source: 'naver_keyword' },
      v('파이썬 강의 모음', 3600),
      v('파이썬 강의 모음', null),
      { youtube_video_id: '', title: '파이썬 강의 모음' },
    ]);
    expect(r.pass.length).toBe(1);
    expect(r.pass[0]).toMatchObject({ title: '파이썬 강의 모음', source: 'naver_keyword' });
    expect(r.filtered).toEqual([
      { id: 'v', reason: 'duplicate_in_batch' },
      { id: 'v', reason: 'duplicate_in_batch' },
      { id: '<missing>', reason: 'no_video_id' },
    ]);
    const bogus = applyQualityGate([{ ...v('파이썬 강의 모음', 600), source: 'bogus' }]);
    expect(bogus.pass[0]!.source).toBeNull();
  });
});

describe('relevanceScores', () => {
  const cells = { A: 'cell a', B: 'cell b' };
  const dot = (a: ReadonlyArray<number>, b: ReadonlyArray<number>): number =>
    a[0]! * b[0]! + a[1]! * b[1]!;

  test('best-cell cosine per text via injected embed/cosine; null on failed embed', async () => {
    const vecs: Record<string, number[] | null> = {
      t1: [1, 0],
      t2: null,
      t3: [0, 1],
      'cell a': [1, 0],
      'cell b': [0, 1],
    };
    const embed = jest.fn(async (texts: string[]) => texts.map((t) => vecs[t] ?? null));
    const out = await relevanceScores(['t1', 't2', 't3'], cells, { embed, cosine: dot });
    expect(out).toEqual([1, null, 1]);
    expect(embed).toHaveBeenCalledTimes(1);
    expect(embed.mock.calls[0]![0]).toEqual(['t1', 't2', 't3', 'cell a', 'cell b']);
  });

  test('empty input and all cell embeddings failed', async () => {
    const embed = jest.fn(async (t: string[]) => t.map((x) => (x === 't' ? [1, 0] : null)));
    expect(await relevanceScores([], cells, { embed, cosine: dot })).toEqual([]);
    expect(await relevanceScores(['t'], cells, { embed, cosine: dot })).toEqual([null]);
  });
});

describe('runCardExperiment', () => {
  const FAR_VEC = [0.1, 0.99];
  const NEAR_VEC = [1, 0];

  test('orchestrates with injected deps; funnel + cap + blocklist + relevance', async () => {
    const metas = [
      mk({ id: 'a', channelId: 'X' }),
      mk({ id: 'b', channelId: 'X' }),
      mk({ id: 'c', channelId: 'X' }),
      mk({ id: 'short', sec: 60, channelId: 'Y' }),
      mk({ id: 'blk', channelId: 'BAD' }),
      mk({ id: 'far', channelId: 'Z', title: '먼주제 강의 FARTOKEN' }),
    ];
    const fetchMetadata = jest.fn(async () => metas);
    const filterBlocked = jest.fn(async (items: YouTubeVideoFullMetadata[]) => {
      const kept = items.filter((m) => m.snippet?.channelId !== 'BAD');
      return { kept, blockedCount: items.length - kept.length };
    });
    const embed = async (texts: string[]) =>
      texts.map((t) => (t.includes('FARTOKEN') ? FAR_VEC : NEAR_VEC));
    const cosine = (a: ReadonlyArray<number>, b: ReadonlyArray<number>): number =>
      a[0]! * b[0]! + a[1]! * b[1]!;

    const out = await runCardExperiment({
      items: ['a', 'b', 'c', 'short', 'blk', 'far', 'missing'].map((videoId) => ({
        videoId,
        cell: 'c1',
      })),
      cells: { c1: 'cell one' },
      deps: { fetchMetadata, filterBlocked, relevance: { embed, cosine }, now: () => NOW },
    });

    const by = Object.fromEntries(out.results.map((r) => [r.videoId, r]));
    expect(by['a']!.finalPass).toBe(true);
    expect(by['b']!.finalPass).toBe(true);
    expect(by['c']!.pass).toBe(true);
    expect(by['c']!.capped).toBe(true);
    expect(by['c']!.finalPass).toBe(false);
    expect(by['short']!.failures.map((f) => f.filter)).toEqual([
      'ingest_quality_gate',
      'shorts_duration_75',
    ]);
    expect(by['blk']!.failures.map((f) => f.filter)).toEqual(['channel_blocked']);
    expect(by['far']!.failures.map((f) => f.filter)).toEqual(['relevance_cut']);
    expect(by['far']!.margins!.cosine).toBeCloseTo(0.1, 5);
    expect(by['a']!.margins!.cosine).toBe(1);
    expect(by['missing']!.found).toBe(false);

    const f = out.funnel;
    expect(f.total).toBe(7);
    expect(f.found).toBe(6);
    expect(f.notFound).toBe(1);
    expect(f.failedByFilter.ingest_quality_gate).toBe(1);
    expect(f.failedByFilter.shorts_duration_75).toBe(1);
    expect(f.failedByFilter.channel_blocked).toBe(1);
    expect(f.failedByFilter.relevance_cut).toBe(1);
    expect(f.capped).toBe(1);
    expect(f.finalPass).toBe(2);
    expect(f.sequential[f.sequential.length - 1]).toEqual({
      filter: 'channel_cap',
      removed: 1,
      remaining: 2,
    });
    expect(fetchMetadata).toHaveBeenCalledWith(['a', 'b', 'c', 'short', 'blk', 'far', 'missing']);
  });

  test('without cells the relevance cut is skipped', async () => {
    const out = await runCardExperiment({
      items: [{ videoId: 'a' }],
      deps: {
        fetchMetadata: async () => [mk({ id: 'a' })],
        filterBlocked: async (items) => ({ kept: items, blockedCount: 0 }),
        now: () => NOW,
      },
    });
    expect(out.results[0]!.finalPass).toBe(true);
    expect(buildFunnel(out.results).finalPass).toBe(1);
  });
});
