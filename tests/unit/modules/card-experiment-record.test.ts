/**
 * Card experiment record glue — injected fakes only (no network, no DB, no LLM).
 */

import {
  recordCandidates,
  type RecordDeps,
  type RecordItem,
  type YouTubeVideoFullMetadata,
} from '@/modules/card-experiment';
import type { FetchFn, MeasurementRecord } from '@/modules/measurement';

const NOW = new Date('2026-11-09T00:00:00Z');
const SECRET_COMMENT = '비밀댓글 도움 광고 SECRET_COMMENT_TEXT';

function iso(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `PT${h}H${m}M${s}S`;
}

interface Over {
  id: string;
  title?: string;
  sec?: number;
  embeddable?: boolean;
  audio?: string;
  channelId?: string;
  views?: string;
}

function mk(o: Over): YouTubeVideoFullMetadata {
  return {
    id: o.id,
    snippet: {
      title: o.title ?? '파이썬 기초 강의 입문편',
      description: '파이썬 입문 강의입니다',
      channelId: o.channelId ?? 'UC1',
      channelTitle: `채널-${o.channelId ?? 'UC1'}`,
      publishedAt: '2026-11-01T00:00:00Z',
      liveBroadcastContent: 'none',
      defaultAudioLanguage: o.audio ?? 'ko',
    },
    contentDetails: { duration: iso(o.sec ?? 600), caption: 'true', definition: 'hd' },
    statistics: { viewCount: o.views ?? '1000', likeCount: '50', commentCount: '10' },
    status: { embeddable: o.embeddable ?? true },
  };
}

interface FakeFetch {
  fn: FetchFn;
  urls: string[];
}

function fakeFetch(opts: { commentsDisabledFor?: string[] } = {}): FakeFetch {
  const urls: string[] = [];
  const fn: FetchFn = async (url) => {
    urls.push(url);
    const ok = (body: unknown): Awaited<ReturnType<FetchFn>> => ({
      ok: true,
      status: 200,
      json: async () => body,
    });
    if (url.includes('/channels?')) {
      return ok({
        items: [
          {
            snippet: { publishedAt: '2020-01-01T00:00:00Z' },
            contentDetails: { relatedPlaylists: { uploads: 'UU1' } },
            statistics: { subscriberCount: '5000', videoCount: '120' },
          },
        ],
      });
    }
    if (url.includes('/playlistItems?')) {
      return ok({
        items: [{ contentDetails: { videoId: 'r1' } }, { contentDetails: { videoId: 'r2' } }],
      });
    }
    if (url.includes('/videos?')) {
      return ok({
        items: [
          {
            snippet: { publishedAt: '2026-10-01T00:00:00Z' },
            contentDetails: { duration: 'PT10M' },
            statistics: { viewCount: '500' },
          },
          {
            snippet: { publishedAt: '2026-09-01T00:00:00Z' },
            contentDetails: { duration: 'PT12M' },
            statistics: { viewCount: '1500' },
          },
        ],
      });
    }
    if (url.includes('/commentThreads')) {
      const disabled = (opts.commentsDisabledFor ?? []).some((id) => url.includes(`videoId=${id}`));
      if (disabled) {
        return {
          ok: false,
          status: 403,
          json: async () => ({ error: { errors: [{ reason: 'commentsDisabled' }] } }),
        };
      }
      return ok({
        items: [{ snippet: { topLevelComment: { snippet: { textOriginal: SECRET_COMMENT } } } }],
      });
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return { fn, urls };
}

function baseDeps(metas: YouTubeVideoFullMetadata[], ff: FakeFetch): RecordDeps {
  return {
    fetchMetadata: async (ids) => metas.filter((m) => m.id && ids.includes(m.id)),
    filterBlocked: async (items) => ({ kept: items, blockedCount: 0 }),
    relevance: {
      embed: async (texts) => texts.map(() => [1, 0]),
      cosine: (a, b) => a.reduce((s, v, i) => s + v * (b[i] ?? 0), 0),
    },
    fetchFn: ff.fn,
    now: () => NOW,
  };
}

function item(videoId: string, over: Partial<RecordItem> = {}): RecordItem {
  return {
    videoId,
    cell: 'python',
    branch: 'track1',
    sourceKind: 'search_keyword',
    keyword: '파이썬 강의',
    discoveryPaths: 2,
    ...over,
  };
}

const CELLS = { python: ['파이썬 프로그래밍 기초'] };

describe('recordCandidates', () => {
  test('candidate passing everything yields full record', async () => {
    const ff = fakeFetch();
    const out = await recordCandidates({
      items: [item('v1', { subCell: 'basics' })],
      runId: 'run-1',
      cellDescriptions: CELLS,
      apiKeys: 'k',
      deps: baseDeps([mk({ id: 'v1' })], ff),
    });
    expect(out.records).toHaveLength(1);
    const r = out.records[0]!;
    expect(r.gate.pass).toBe(true);
    expect(r.gate.failures).toEqual([]);
    expect(r.sheet.pass).toBe(true);
    expect(r.relevanceCosine).toBe(1);
    expect(r.subCell).toBe('basics');
    expect(r.branch).toBe('track1');
    expect(r.keyword).toBe('파이썬 강의');
    expect(r.discoveryPaths).toBe(2);
    expect(r.durationSec).toBe(600);
    expect(r.measurement.video.duration_sec).toBe(600);
    expect(r.measurement.reaction.view_count).toBe(1000);
    expect(r.measurement.channel?.subscriber_count).toBe(5000);
    expect(r.measurement.channel?.views_multiple_vs_channel_median).toBeCloseTo(1, 5);
    expect(r.measurement.comment_signals).toMatchObject({ sampled: 1, disabled: false });
    expect(r.measurement.title_shape.has_howto).toBe(true);
    expect(out.funnel.finalPass).toBe(1);
  });

  test('shorts / off-language / not embeddable recorded in trace and sheet', async () => {
    const ff = fakeFetch();
    const written: MeasurementRecord[] = [];
    const out = await recordCandidates({
      items: [item('bad', { branch: 'track2' })],
      runId: 'run-2',
      cellDescriptions: CELLS,
      apiKeys: 'k',
      writeDb: true,
      deps: {
        ...baseDeps(
          [
            mk({
              id: 'bad',
              title: 'Python tutorial for beginners',
              sec: 60,
              embeddable: false,
              audio: 'fr',
            }),
          ],
          ff
        ),
        measurementEnabled: true,
        writer: async (recs) => {
          written.push(...recs);
          return recs.length;
        },
      },
    });
    const r = out.records[0]!;
    const filters = r.gate.failures.map((f) => f.filter);
    expect(r.gate.pass).toBe(false);
    expect(filters).toEqual(
      expect.arrayContaining(['shorts_duration_75', 'off_language_title', 'not_embeddable'])
    );
    const shorts = r.gate.failures.find((f) => f.filter === 'shorts_duration_75')!;
    expect(shorts).toMatchObject({ value: 60, threshold: 75 });
    expect(r.sheet.pass).toBe(false);
    expect(r.sheet.failed).toEqual(expect.arrayContaining(['duration', 'embeddable', 'language']));
    expect(out.funnel.failedByFilter.not_embeddable).toBe(1);
    expect(out.written).toBe(1);
    expect(written[0]?.filterTrace?.map((t) => t.filter)).toEqual(filters);
    expect(written[0]?.branch).toBe('track2');
  });

  test('writeDb off or flag off writes nothing', async () => {
    const ff = fakeFetch();
    const writer = jest.fn(async (recs: readonly MeasurementRecord[]) => recs.length);
    const deps = { ...baseDeps([mk({ id: 'v1' })], ff), writer, measurementEnabled: true };
    const a = await recordCandidates({
      items: [item('v1')],
      runId: 'r',
      cellDescriptions: CELLS,
      apiKeys: 'k',
      deps,
    });
    const b = await recordCandidates({
      items: [item('v1')],
      runId: 'r',
      cellDescriptions: CELLS,
      apiKeys: 'k',
      writeDb: true,
      deps: { ...deps, measurementEnabled: false },
    });
    expect(a.written).toBe(0);
    expect(b.written).toBe(0);
    expect(writer).not.toHaveBeenCalled();
  });

  test('channel fetched once for two videos of the same channel; units counted', async () => {
    const ff = fakeFetch();
    const out = await recordCandidates({
      items: [item('v1'), item('v2')],
      runId: 'run-3',
      cellDescriptions: CELLS,
      apiKeys: 'k',
      deps: baseDeps([mk({ id: 'v1', views: '1000' }), mk({ id: 'v2', views: '2000' })], ff),
    });
    expect(ff.urls.filter((u) => u.includes('/channels?'))).toHaveLength(1);
    expect(ff.urls.filter((u) => u.includes('/playlistItems?'))).toHaveLength(1);
    expect(ff.urls.filter((u) => u.includes('/videos?'))).toHaveLength(1);
    expect(ff.urls.filter((u) => u.includes('/commentThreads'))).toHaveLength(2);
    // median of recent views (500, 1500) = 1000
    expect(out.records[0]!.measurement.channel?.views_multiple_vs_channel_median).toBeCloseTo(1, 5);
    expect(out.records[1]!.measurement.channel?.views_multiple_vs_channel_median).toBeCloseTo(2, 5);
    expect(out.units).toEqual({ videos: 2, channels: 1, playlistItems: 1, commentThreads: 2 });
  });

  test('comments disabled is tolerated and counted', async () => {
    const ff = fakeFetch({ commentsDisabledFor: ['v1'] });
    const out = await recordCandidates({
      items: [item('v1'), item('v2')],
      runId: 'run-4',
      cellDescriptions: CELLS,
      apiKeys: 'k',
      deps: baseDeps([mk({ id: 'v1' }), mk({ id: 'v2' })], ff),
    });
    expect(out.records[0]!.measurement.comment_signals).toMatchObject({
      disabled: true,
      sampled: 0,
    });
    expect(out.records[1]!.measurement.comment_signals?.disabled).toBe(false);
    expect(out.skipped.commentsDisabled).toBe(1);
  });

  test('unknown id is skipped without a record', async () => {
    const ff = fakeFetch();
    const out = await recordCandidates({
      items: [item('v1'), item('ghost')],
      runId: 'run-5',
      cellDescriptions: CELLS,
      apiKeys: 'k',
      deps: baseDeps([mk({ id: 'v1' })], ff),
    });
    expect(out.records).toHaveLength(1);
    expect(out.skipped.notFound).toBe(1);
    expect(out.funnel.notFound).toBe(1);
  });

  test('no comment text anywhere in the result', async () => {
    const ff = fakeFetch();
    const out = await recordCandidates({
      items: [item('v1'), item('v2')],
      runId: 'run-6',
      cellDescriptions: CELLS,
      apiKeys: 'k',
      deps: baseDeps([mk({ id: 'v1' }), mk({ id: 'v2' })], ff),
    });
    const json = JSON.stringify(out);
    expect(json).not.toContain('비밀댓글');
    expect(json).not.toContain('SECRET_COMMENT_TEXT');
    expect(out.records[0]!.measurement.comment_signals?.positive_count).toBe(1);
    expect(out.records[0]!.measurement.comment_signals?.negative_count).toBe(1);
  });
});
