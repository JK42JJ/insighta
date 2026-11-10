import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FeedApiCard, InsightData } from '@/features/morning-cards/api';
import { buildChapters, buildChecks, toFeedCard } from '@/features/morning-feed/feed-format';
import {
  buildCellRows,
  buildInsightSummary,
  formatMinutes,
  formatWatchTime,
  orderRowText,
} from '@/features/morning-feed/insight-summary';
import {
  advanceWatchClock,
  WATCH_POLL_MS,
  WATCH_REPORT_MS,
  WatchReporter,
  YT_STATE_PLAYING,
} from '@/features/morning-feed/use-watch-reporter';

const NOW = new Date('2026-11-07T12:00:00Z');
const base: FeedApiCard = {
  video_id: 'abcdefghijk',
  title: '제목',
  channel: '채널',
  published_at: NOW.toISOString(),
  duration: 600,
  view_count: null,
  thumbnail_url: null,
  cell: '기술/개발',
  focus: [],
  why: '2일 전 올라온 영상',
};

describe('toFeedCard info mapping', () => {
  it('adds no info fields when the server sent none', () => {
    const c = toFeedCard(base, ['#111'], NOW);
    expect(c.oneLiner).toBeUndefined();
    expect(c.reasonLines).toBeUndefined();
    expect(c.checks).toBeUndefined();
    expect(c.chapters).toBeUndefined();
  });

  it('maps one-liner, reason lines (trimmed, no empties), checks and chapters', () => {
    const c = toFeedCard(
      {
        ...base,
        info: {
          one_liner: '  한 줄  ',
          reason: ' 첫째 \n\n 둘째 ',
          audio_language: 'ko',
          link_count: 4,
          chapters: [
            { sec: 0, title: '시작' },
            { sec: 75, title: '본론' },
            { sec: 3725, title: '끝' },
          ],
        },
      },
      ['#111'],
      NOW
    );
    expect(c.oneLiner).toBe('한 줄');
    expect(c.reasonLines).toEqual(['첫째', '둘째']);
    expect(c.checks).toEqual([{ text: '✓ 한국어 음성' }, { text: '✓ 설명란 링크 4건' }]);
    expect(c.chapters).toEqual([
      { at: '0:00', title: '시작' },
      { at: '1:15', title: '본론' },
      { at: '1:02:05', title: '끝' },
    ]);
  });
});

describe('checks', () => {
  it('names common non-Korean languages without a check mark, else shows the code', () => {
    expect(buildChecks({ audio_language: 'en' })).toEqual([{ text: '음성 언어 영어' }]);
    expect(buildChecks({ audio_language: 'ja' })).toEqual([{ text: '음성 언어 일본어' }]);
    expect(buildChecks({ audio_language: 'zh-CN' })).toEqual([{ text: '음성 언어 중국어' }]);
    expect(buildChecks({ audio_language: 'fr' })).toEqual([{ text: '음성 언어 fr' }]);
    expect(buildChecks({ audio_language: 'ko-KR' })).toEqual([{ text: '✓ 한국어 음성' }]);
  });
  it('shows links only for 1 or more and hides empty data', () => {
    expect(buildChecks({ link_count: 0 })).toEqual([]);
    expect(buildChecks({ link_count: 1 })).toEqual([{ text: '✓ 설명란 링크 1건' }]);
    expect(buildChecks({ audio_language: '  ' })).toEqual([]);
    expect(buildChecks(undefined)).toEqual([]);
  });
});

describe('chapters', () => {
  it('needs at least three entries', () => {
    expect(
      buildChapters([
        { sec: 0, title: 'a' },
        { sec: 10, title: 'b' },
      ])
    ).toEqual([]);
    expect(buildChapters(undefined)).toEqual([]);
  });
  it('drops invalid entries before counting', () => {
    expect(
      buildChapters([
        { sec: 0, title: 'a' },
        { sec: 10, title: ' ' },
        { sec: 20, title: 'c' },
      ])
    ).toEqual([]);
  });
});

const insight = (over: Partial<InsightData> = {}): InsightData => ({
  date_kst: '2026-11-10',
  reacted: 5,
  liked: 2,
  disliked: 1,
  passed: 2,
  watched_seconds_total: 1500,
  has_watch_data: true,
  by_cell: [],
  order: [],
  ...over,
});

describe('insight text', () => {
  it('formats minutes and total time from seconds only', () => {
    expect(formatMinutes(null)).toBe('');
    expect(formatMinutes(0)).toBe('');
    expect(formatMinutes(20)).toBe('1분');
    expect(formatMinutes(660)).toBe('11분');
    expect(formatWatchTime(null)).toBe('');
    expect(formatWatchTime(30)).toBe('1분 미만');
    expect(formatWatchTime(1500)).toBe('25분');
    expect(formatWatchTime(3600)).toBe('1시간');
    expect(formatWatchTime(5400)).toBe('1시간 30분');
  });

  it('builds the summary from real numbers', () => {
    expect(buildInsightSummary(insight())).toBe(
      '오늘 5편에 반응했고, 그중 2편을 좋아했습니다. 본 시간은 25분입니다. 넘긴 영상은 2편입니다.'
    );
  });

  it('leaves out time without watch data, likes at zero and passes at zero', () => {
    expect(
      buildInsightSummary(
        insight({ has_watch_data: false, watched_seconds_total: null, liked: 0, passed: 0 })
      )
    ).toBe('오늘 5편에 반응했습니다.');
    expect(buildInsightSummary(insight({ reacted: 0 }))).toBe('');
  });

  it('row text: minutes only from watched seconds, never for a pass', () => {
    const row = (verdict: 'useful' | 'skip' | 'pass', w: number | null) => ({
      video_id: 'x',
      title: 't',
      verdict,
      cell: 'c',
      duration_seconds: 900,
      watched_seconds: w,
      at: '',
    });
    expect(orderRowText(row('useful', 660))).toBe('좋아 · 11분');
    expect(orderRowText(row('skip', 480))).toBe('별로 · 8분');
    expect(orderRowText(row('useful', null))).toBe('좋아');
    expect(orderRowText(row('pass', 300))).toBe('넘김');
  });

  it('cell rows: bars by watched time, longest first; plain counts without watch data', () => {
    const by_cell = [
      { cell: 'A', count: 1, watched_seconds: 300 },
      { cell: 'B', count: 2, watched_seconds: 600 },
    ];
    expect(buildCellRows({ has_watch_data: true, by_cell })).toEqual([
      { cell: 'B', text: '10분', percent: 100 },
      { cell: 'A', text: '5분', percent: 50 },
    ]);
    expect(buildCellRows({ has_watch_data: false, by_cell })).toEqual([
      { cell: 'A', text: '1편', percent: null },
      { cell: 'B', text: '2편', percent: null },
    ]);
  });
});

describe('watch clock', () => {
  it('adds elapsed wall-clock time, capped at one poll interval', () => {
    let c = advanceWatchClock({ watchedMs: 0, lastTickMs: null }, 1000, true);
    expect(c).toEqual({ watchedMs: 0, lastTickMs: 1000 });
    c = advanceWatchClock(c, 1000 + 3000, true);
    expect(c.watchedMs).toBe(3000);
    c = advanceWatchClock(c, 4000 + 60_000, true); // long gap: capped
    expect(c.watchedMs).toBe(3000 + WATCH_POLL_MS);
  });

  it('a seek does not matter: only wall-clock time counts', () => {
    const c = advanceWatchClock({ watchedMs: 0, lastTickMs: 0 }, 5000, true);
    expect(c.watchedMs).toBe(5000);
  });

  it('stops counting when not playing', () => {
    const c = advanceWatchClock({ watchedMs: 2000, lastTickMs: 0 }, 1000, false);
    expect(c).toEqual({ watchedMs: 3000, lastTickMs: null });
    expect(advanceWatchClock(c, 9000, false).watchedMs).toBe(3000);
  });
});

describe('WatchReporter', () => {
  let t = 0;
  const sent: Array<{ video_id: string; watched_seconds: number; last_position: number }> = [];
  const make = () =>
    new WatchReporter({ send: (b) => void sent.push(b), now: () => t, position: () => 42.9 });
  beforeEach(() => {
    vi.useFakeTimers();
    t = 0;
    sent.length = 0;
  });
  afterEach(() => vi.useRealTimers());
  const advance = async (ms: number) => {
    t += ms;
    await vi.advanceTimersByTimeAsync(ms);
  };

  it('never sends when nothing was watched', () => {
    const r = make();
    r.setVideo('v1');
    r.onState(2);
    r.dispose();
    expect(sent).toEqual([]);
  });

  it('sends on pause with whole seconds and the floored position', async () => {
    const r = make();
    r.setVideo('v1');
    r.onState(YT_STATE_PLAYING);
    await advance(WATCH_POLL_MS);
    await advance(WATCH_POLL_MS);
    r.onState(2);
    expect(sent).toEqual([{ video_id: 'v1', watched_seconds: 10, last_position: 42 }]);
  });

  it('reports at most every WATCH_REPORT_MS while playing', async () => {
    const r = make();
    r.setVideo('v1');
    r.onState(YT_STATE_PLAYING);
    await advance(WATCH_REPORT_MS - WATCH_POLL_MS);
    expect(sent).toHaveLength(0);
    await advance(WATCH_POLL_MS);
    expect(sent).toHaveLength(1);
    expect(sent[0].watched_seconds).toBe(WATCH_REPORT_MS / 1000);
    r.dispose();
  });

  it('a card change reports the previous card and starts over', async () => {
    const r = make();
    r.setVideo('v1');
    r.onState(YT_STATE_PLAYING);
    await advance(WATCH_POLL_MS);
    r.setVideo('v2');
    expect(sent.map((s) => s.video_id)).toEqual(['v1']);
    r.onState(YT_STATE_PLAYING);
    await advance(WATCH_POLL_MS);
    r.onState(0);
    expect(sent[1]).toMatchObject({ video_id: 'v2', watched_seconds: 5 });
  });
});
