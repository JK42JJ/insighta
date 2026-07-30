/**
 * V0 dial video tab (2026-07-30) — pure helpers behind
 * GET /api/v1/mandalas/:id/videos. Sort must mirror the FE dashboard
 * relevance-sort comparator (NULL → recency proxy ≤ 60, 90d fade); dedupe must
 * prefer scored rows and uvs; segCoverage feeds the core-only eligibility gate.
 */

import {
  NULL_RECENCY_CAP,
  NULL_RECENCY_WINDOW_MS,
  videoListSortValue,
  makeVideoListComparator,
  dedupeByVideoId,
  segCoverage,
  type VideoListEntry,
} from '@/modules/mandala/video-list';

const NOW = 1_800_000_000_000;

const entry = (over: Partial<VideoListEntry>): VideoListEntry => ({
  videoId: 'vid00000000',
  title: 't',
  channel: null,
  thumbnail: null,
  durationSec: null,
  views: null,
  relevancePct: null,
  pinnedAt: null,
  createdAtMs: NOW,
  source: 'uvs',
  ...over,
});

describe('videoListSortValue', () => {
  it('returns the real score when present, even 0', () => {
    expect(videoListSortValue(87, NOW, NOW)).toBe(87);
    expect(videoListSortValue(0, NOW, NOW)).toBe(0);
  });

  it('caps a brand-new unscored row at NULL_RECENCY_CAP (below the recommended tier 70)', () => {
    expect(videoListSortValue(null, NOW, NOW)).toBe(NULL_RECENCY_CAP);
  });

  it('fades linearly to 0 over the 90d window', () => {
    const half = videoListSortValue(null, NOW - NULL_RECENCY_WINDOW_MS / 2, NOW);
    expect(half).toBeCloseTo(NULL_RECENCY_CAP / 2, 5);
    expect(videoListSortValue(null, NOW - NULL_RECENCY_WINDOW_MS * 2, NOW)).toBe(0);
  });
});

describe('makeVideoListComparator', () => {
  it('sorts scored above fresh-unscored when the score beats the cap', () => {
    const scored = entry({ videoId: 'scored00000', relevancePct: 71 });
    const fresh = entry({ videoId: 'fresh000000', relevancePct: null, createdAtMs: NOW });
    const out = [fresh, scored].sort(makeVideoListComparator(NOW));
    expect(out[0]!.videoId).toBe('scored00000');
  });

  it('interleaves a fresh unscored row above a low-scored one (no bottom-dumping)', () => {
    const low = entry({ videoId: 'low00000000', relevancePct: 30 });
    const fresh = entry({ videoId: 'fresh000000', relevancePct: null, createdAtMs: NOW });
    const out = [low, fresh].sort(makeVideoListComparator(NOW));
    expect(out[0]!.videoId).toBe('fresh000000');
  });

  it('breaks ties by videoId so pagination is stable across refetches', () => {
    const a = entry({ videoId: 'aaaaaaaaaaa', relevancePct: 50 });
    const b = entry({ videoId: 'bbbbbbbbbbb', relevancePct: 50 });
    expect([b, a].sort(makeVideoListComparator(NOW))[0]!.videoId).toBe('aaaaaaaaaaa');
  });
});

describe('dedupeByVideoId', () => {
  it('keeps the scored row over the unscored duplicate regardless of order', () => {
    const unscored = entry({ source: 'uvs', relevancePct: null });
    const scored = entry({ source: 'ulc', relevancePct: 88 });
    expect(dedupeByVideoId([unscored, scored])[0]!.relevancePct).toBe(88);
    expect(dedupeByVideoId([scored, unscored])[0]!.relevancePct).toBe(88);
  });

  it('prefers uvs on equal scoredness (primary placement table)', () => {
    const ulc = entry({ source: 'ulc', relevancePct: 90, title: 'ulc' });
    const uvs = entry({ source: 'uvs', relevancePct: 90, title: 'uvs' });
    expect(dedupeByVideoId([ulc, uvs])[0]!.title).toBe('uvs');
    expect(dedupeByVideoId([uvs, ulc])[0]!.title).toBe('uvs');
  });

  it('leaves distinct videos untouched', () => {
    const a = entry({ videoId: 'aaaaaaaaaaa' });
    const b = entry({ videoId: 'bbbbbbbbbbb' });
    expect(dedupeByVideoId([a, b])).toHaveLength(2);
  });
});

describe('segCoverage', () => {
  it('computes last-section end over duration, clamped to 1', () => {
    expect(segCoverage([{ to_sec: 540 }], 600)).toBeCloseTo(0.9, 5);
    expect(segCoverage([{ to_sec: 700 }], 600)).toBe(1);
  });

  it('is null when sections or duration are unusable (#1078 honesty: no fake full coverage)', () => {
    expect(segCoverage(null, 600)).toBeNull();
    expect(segCoverage([], 600)).toBeNull();
    expect(segCoverage([{ to_sec: 540 }], null)).toBeNull();
    expect(segCoverage([{ to_sec: 'x' }], 600)).toBeNull();
  });
});
