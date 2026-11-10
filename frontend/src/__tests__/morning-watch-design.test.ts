import { afterEach, describe, expect, it, vi } from 'vitest';

import type { InsightData } from '@/features/morning-cards/api';
import { parseFixtureScreen } from '@/features/morning-feed/fixture-screen';
import {
  buildWatchSummary,
  carryCandidate,
  chapterStamp,
  historyMetaText,
  insightViewFromData,
  kstDateLabel,
  kstDay,
  readOnboardingSeen,
  WATCH_LEVELS,
  WATCH_ONB_SEEN_KEY,
  wholeMinutes,
  writeOnboardingSeen,
} from '@/features/morning-feed/watch-design';
import {
  FIXTURE_DATE_LABEL,
  FIXTURE_DEFAULT_REACTS,
  FIXTURE_GOALS,
  FIXTURE_HISTORY,
  FIXTURE_PRESET,
  fixtureCustomGoal,
  fixtureInsight,
  fixtureItemView,
  fixtureVids,
} from '@/features/morning-feed/watch-fixture-data';

describe('watch flow: date header and history text', () => {
  it('header date is the KST day: 11월 10일 화요일', () => {
    expect(kstDateLabel(new Date('2026-11-09T15:00:00Z'))).toBe('11월 10일 화요일');
    expect(kstDateLabel(new Date('2026-11-09T14:59:59Z'))).toBe('11월 9일 월요일');
    expect(kstDateLabel(new Date('2026-11-10T03:00:00Z'))).toBe(FIXTURE_DATE_LABEL);
  });

  it('KST day strings, with an offset', () => {
    const now = new Date('2026-11-09T15:30:00Z'); // 11-10 00:30 KST
    expect(kstDay(now)).toBe('2026-11-10');
    expect(kstDay(now, -1)).toBe('2026-11-09');
  });

  it("history row text: '10월 28일 · 12편'; a malformed day gives ''", () => {
    expect(historyMetaText('2026-10-28', 12)).toBe('10월 28일 · 12편');
    expect(historyMetaText('2026-10-04', 8)).toBe('10월 4일 · 8편');
    expect(historyMetaText('2026/10/28', 3)).toBe('');
  });

  it('어제에 이어서 only when the newest history row is yesterday (KST)', () => {
    const now = new Date('2026-11-10T03:00:00Z'); // 11-10 KST
    const row = (day: string) => ({ cell: '기술/개발', day, count: 5 });
    expect(carryCandidate([row('2026-11-09'), row('2026-11-01')], now)).toEqual(row('2026-11-09'));
    expect(carryCandidate([row('2026-11-08')], now)).toBeNull();
    expect(carryCandidate([], now)).toBeNull();
  });

  it("chapter stamps take two-digit minutes like the handoff ('3:10' -> '03:10')", () => {
    expect(chapterStamp('3:10')).toBe('03:10');
    expect(chapterStamp('12:05')).toBe('12:05');
    expect(chapterStamp('1:02:03')).toBe('1:02:03');
  });
});

describe('watch flow: insight paragraph', () => {
  it('follows the README formula word for word', () => {
    expect(
      buildWatchSummary({
        received: 5,
        watched: 4,
        minutes: 42,
        topBranch: '채권 직접 사 보기',
        likes: 3,
        skips: 1,
      })
    ).toBe(
      '오늘 받은 5편 가운데 4편을 봤고 42분을 썼습니다. 가장 오래 본 갈래는 "채권 직접 사 보기"입니다. 좋다고 한 영상은 3편입니다. 넘긴 1편은 내일 목록에서 빼고 비슷한 다른 영상으로 바꿉니다.'
    );
  });

  it('leaves out only the part whose data is missing; no skips reads 넘긴 영상은 없습니다', () => {
    expect(
      buildWatchSummary({
        received: 2,
        watched: 2,
        minutes: null,
        topBranch: null,
        likes: 0,
        skips: 0,
      })
    ).toBe('오늘 받은 2편 가운데 2편을 봤습니다. 넘긴 영상은 없습니다.');
  });

  it('whole minutes from seconds; unknown stays null', () => {
    expect(wholeMinutes(1260)).toBe(21);
    expect(wholeMinutes(150)).toBe(3);
    expect(wholeMinutes(null)).toBeNull();
    expect(wholeMinutes(-1)).toBeNull();
  });

  const data = (over: Partial<InsightData>): InsightData => ({
    date_kst: '2026-11-10',
    reacted: 3,
    liked: 2,
    disliked: 1,
    passed: 1,
    watched_seconds_total: 1260,
    has_watch_data: true,
    by_cell: [{ cell: '기술/개발', count: 3, watched_seconds: 1260 }],
    order: [
      {
        video_id: 'a',
        title: 'A',
        verdict: 'useful',
        cell: '기술/개발',
        duration_seconds: 700,
        watched_seconds: 660,
        at: '2026-11-10T01:00:00Z',
      },
      {
        video_id: 'b',
        title: 'B',
        verdict: 'skip',
        cell: '기술/개발',
        duration_seconds: 500,
        watched_seconds: null,
        at: '2026-11-10T01:10:00Z',
      },
      {
        video_id: 'c',
        title: 'C',
        verdict: 'pass',
        cell: '기술/개발',
        duration_seconds: 500,
        watched_seconds: 20,
        at: '2026-11-10T01:20:00Z',
      },
    ],
    ...over,
  });
  const shortOf = (label: string) => (label === '기술/개발' ? '기술·개발' : label);

  it('live insight: received = answered incl. passed, watched = not passed, time and bars from watch data', () => {
    const v = insightViewFromData(data({}), shortOf);
    expect(v.paragraph).toBe(
      '오늘 받은 4편 가운데 3편을 봤고 21분을 썼습니다. 가장 오래 본 갈래는 "기술·개발"입니다. 좋다고 한 영상은 2편입니다. 넘긴 1편은 내일 목록에서 빼고 비슷한 다른 영상으로 바꿉니다.'
    );
    expect(v.stats).toEqual([
      { k: '본 영상', v: 3, u: '편' },
      { k: '본 시간', v: 21, u: '분' },
      { k: '좋아', v: 2, u: '편' },
    ]);
    expect(v.rows.map((r) => [r.title, r.tag, r.kind])).toEqual([
      ['A', '좋아 · 11분', 'like'],
      ['B', '별로', 'dislike'],
      ['C', '넘김', 'pass'],
    ]);
    expect(v.bars).toEqual([{ label: '기술·개발', min: 21, pct: 100 }]);
  });

  it('live insight without watch data: no time chip, no minutes, no bars', () => {
    const v = insightViewFromData(
      data({
        watched_seconds_total: null,
        has_watch_data: false,
        by_cell: [{ cell: '기술/개발', count: 3, watched_seconds: null }],
      }),
      shortOf
    );
    expect(v.stats.map((s) => s.k)).toEqual(['본 영상', '좋아']);
    expect(v.bars).toEqual([]);
    expect(v.paragraph.startsWith('오늘 받은 4편 가운데 3편을 봤습니다. 좋다고')).toBe(true);
  });
});

describe('watch flow: fixture data (prototype example, copied)', () => {
  it('has the four goals, the full 금리와 채권 data, LEVELS and the two history rows', () => {
    expect(FIXTURE_GOALS.map((g) => g.title)).toEqual([
      '금리와 채권 이해하기',
      '영어 회의에서 말문 트기',
      '달리기 10km 완주하기',
      '파이썬으로 데이터 다루기',
    ]);
    const bond = FIXTURE_GOALS[0];
    expect(bond.branches).toHaveLength(4);
    expect(bond.rec).toEqual([
      [0, 1, 2],
      [1, 2],
      [1, 3],
    ]);
    expect(bond.vids).toHaveLength(5);
    for (const v of bond.vids) {
      expect(v.sum && v.why).toBeTruthy();
      expect(v.pts).toHaveLength(3);
      expect(v.checks).toHaveLength(3);
    }
    for (const g of FIXTURE_GOALS) {
      expect(g.rec).toHaveLength(3);
      for (const v of g.vids) expect(v.br).toBeLessThan(g.branches.length);
    }
    expect(WATCH_LEVELS).toEqual([
      '처음 배웁니다',
      '조금 알고 있습니다',
      '일이나 생활에서 이미 쓰고 있습니다',
    ]);
    expect(FIXTURE_HISTORY.map((h) => [h.t, h.meta])).toEqual([
      ['영어 회의에서 말문 트기', '10월 28일 · 12편'],
      ['달리기 10km 완주하기', '10월 14일 · 8편'],
    ]);
    expect(fixtureCustomGoal('전세').branches).toEqual(['기본 개념', '실제 사례', '흔한 오해']);
  });

  it('item view: prototype meta line, ✓ checks and stand-in texts for the short goals', () => {
    const bond = FIXTURE_GOALS[0];
    const v = fixtureItemView(bond, 0, bond.vids[0], 0);
    expect(v.meta).toBe('경제 읽는 시간 · 11분 · 금리가 움직이는 이유');
    expect(v.checks.map((c) => c.text)).toEqual([
      '✓ 진행자 1명',
      '✓ 한국어 음성',
      '✓ 설명란 출처 4건',
    ]);
    expect(v.chapters[1]).toEqual({ at: '03:10', title: '금융통화위원회가 하는 일' });
    const eng = FIXTURE_GOALS[1];
    const e = fixtureItemView(eng, 1, eng.vids[0], 0);
    expect(e.summary).toBe('"자주 쓰는 표현" 갈래에서 고른 영상입니다. (예시 데이터: 요약 미작성)');
    expect(e.reasonLines).toEqual([
      '"조금 알고 있습니다"라고 하셔서 이 수준에 맞는 설명을 골랐습니다.',
    ]);
    expect(e.chapters).toEqual([]);
  });

  it("insight preset: goal 0, branches [0,1,2,3], the prototype's default reactions", () => {
    const goal = FIXTURE_GOALS[FIXTURE_PRESET.goal];
    const vids = fixtureVids(goal, FIXTURE_PRESET.sel);
    expect(vids).toHaveLength(5);
    const v = fixtureInsight(goal, vids, FIXTURE_DEFAULT_REACTS.slice(0, vids.length));
    expect(v.paragraph).toBe(
      '오늘 받은 5편 가운데 4편을 봤고 42분을 썼습니다. 가장 오래 본 갈래는 "채권 직접 사 보기"입니다. 좋다고 한 영상은 3편입니다. 넘긴 1편은 내일 목록에서 빼고 비슷한 다른 영상으로 바꿉니다.'
    );
    expect(v.stats.map((s) => s.v)).toEqual([4, 42, 3]);
    expect(v.rows.map((r) => r.tag)).toEqual([
      '좋아 · 11분',
      '좋아 · 9분',
      '넘김',
      '별로 · 8분',
      '좋아 · 14분',
    ]);
    expect(v.bars.map((b) => [b.label, b.min, b.pct])).toEqual([
      ['채권 직접 사 보기', 14, 100],
      ['금리가 움직이는 이유', 11, 79],
      ['채권 가격과 금리', 9, 64],
      ['내 예금·대출에 미치는 영향', 8, 57],
    ]);
  });

  it('fixture screen parameter: onb | input | watch | insight, anything else is 온보딩', () => {
    expect(parseFixtureScreen('watch')).toBe('watch');
    expect(parseFixtureScreen('insight')).toBe('insight');
    expect(parseFixtureScreen('nope')).toBe('onb');
    expect(parseFixtureScreen(null)).toBe('onb');
  });
});

describe('watch flow: onboarding seen flag', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    try {
      window.localStorage.removeItem(WATCH_ONB_SEEN_KEY);
    } catch {
      /* ignore */
    }
  });

  it('is stored on this device and read back', () => {
    expect(readOnboardingSeen()).toBe(false);
    writeOnboardingSeen();
    expect(readOnboardingSeen()).toBe(true);
  });

  it('a storage that throws reads as not seen and writing does not throw', () => {
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readOnboardingSeen()).toBe(false);
    expect(() => writeOnboardingSeen()).not.toThrow();
  });
});
