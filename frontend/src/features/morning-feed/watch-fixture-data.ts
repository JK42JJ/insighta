/*
 * Example data of the design handoff prototype ("Insighta Mobile.dc.html", GOALS / LEVELS /
 * customGoal / history), copied as written, for /morning-cards?view=watch&fixture=1. Every title,
 * channel, summary and number here is the prototype's made-up example. No network, no storage.
 */
import {
  buildWatchSummary,
  WATCH_LEVELS,
  type InsightRowView,
  type InsightView,
  type WatchGoal,
  type WatchItemView,
} from '@/features/morning-feed/watch-design';

export interface FixtureVideo {
  t: string;
  ch: string;
  min: number;
  br: number;
  sum?: string;
  why?: string;
  pts?: Array<[string, string]>;
  checks?: string[];
}

export interface FixtureGoal extends WatchGoal {
  vids: FixtureVideo[];
}

export type FixtureReact = 'like' | 'skip' | 'dislike';

const V = (
  t: string,
  ch: string,
  min: number,
  br: number,
  sum?: string,
  why?: string,
  pts?: Array<[string, string]>,
  checks?: string[]
): FixtureVideo => ({ t, ch, min, br, sum, why, pts, checks });

export const FIXTURE_GOALS: readonly FixtureGoal[] = Object.freeze([
  {
    key: 'bond',
    title: '금리와 채권 이해하기',
    branches: [
      '금리가 움직이는 이유',
      '채권 가격과 금리',
      '내 예금·대출에 미치는 영향',
      '채권 직접 사 보기',
    ],
    rec: [
      [0, 1, 2],
      [1, 2],
      [1, 3],
    ],
    vids: [
      V(
        '기준금리는 누가, 어떻게 정하나',
        '경제 읽는 시간',
        11,
        0,
        '한국은행이 금리를 정하는 절차와, 그 결정이 은행 금리로 번지는 경로를 설명합니다.',
        '용어를 하나씩 풀어 주는 영상이라 맨 앞에 뒀습니다. 도표가 많고 말이 빠르지 않습니다.',
        [
          ['00:00', '기준금리란 무엇인가'],
          ['03:10', '금융통화위원회가 하는 일'],
          ['07:40', '은행 금리로 전달되는 경로'],
        ],
        ['진행자 1명', '한국어 음성', '설명란 출처 4건']
      ),
      V(
        '금리가 오르면 채권 가격은 왜 떨어지나',
        '채권 노트',
        9,
        1,
        '이미 발행된 채권의 이자는 고정이라, 새 금리가 오르면 헌 채권 값이 내려간다는 점을 숫자 예시로 보여 줍니다.',
        '앞 영상의 "금리 전달"에서 바로 이어지는 내용입니다. 계산 예시가 하나뿐이라 따라가기 쉽습니다.',
        [
          ['00:00', '액면가와 표면금리'],
          ['02:50', '100만 원짜리 채권으로 계산해 보기'],
          ['06:30', '만기가 길수록 더 크게 움직이는 이유'],
        ],
        ['진행자 1명', '한국어 음성', '계산 과정 공개']
      ),
      V(
        '국채 10년물 금리, 숫자 읽는 법',
        '채권 노트',
        13,
        1,
        '뉴스에 나오는 "10년물 금리 3.2%"가 무엇을 뜻하는지, 어디서 확인하는지 알려 줍니다.',
        '구독 채널에는 없던 곳입니다. 같은 갈래를 뉴스 읽기 쪽에서 다뤄서 넣었습니다.',
        [
          ['00:00', '수익률과 표면금리의 차이'],
          ['04:20', '금융투자협회 공시 화면 보기'],
          ['09:00', '장단기 금리 차이 읽기'],
        ],
        ['진행자 1명', '한국어 음성', '공시 자료 인용']
      ),
      V(
        '대출 금리는 기준금리를 얼마나 따라가나',
        '생활경제 연구소',
        8,
        2,
        '변동금리 대출이 코픽스를 거쳐 기준금리에 반응하는 시차를 설명합니다.',
        '배운 내용을 내 통장에 대어 볼 수 있는 영상입니다. 상품 권유가 없습니다.',
        [
          ['00:00', '코픽스란'],
          ['03:00', '변동금리가 바뀌는 주기'],
          ['05:40', '고정금리와 비교'],
        ],
        ['진행자 1명', '한국어 음성', '광고·협찬 없음']
      ),
      V(
        '개인이 채권을 사는 세 가지 방법',
        '경제 읽는 시간',
        14,
        3,
        '증권사 장외 거래, 장내 거래, 채권 ETF의 차이와 수수료를 비교합니다.',
        '직접 사 보는 갈래의 첫 영상입니다. 특정 상품을 추천하지 않고 방법만 비교합니다.',
        [
          ['00:00', '장외와 장내의 차이'],
          ['05:10', '채권 ETF는 채권과 무엇이 다른가'],
          ['10:30', '수수료와 세금'],
        ],
        ['진행자 1명', '한국어 음성', '특정 상품 추천 없음']
      ),
    ],
  },
  {
    key: 'eng',
    title: '영어 회의에서 말문 트기',
    branches: ['자주 쓰는 표현', '끼어들기와 되묻기', '짧게 의견 말하기'],
    rec: [[0, 1], [1, 2], [2]],
    vids: [
      V('회의 첫 5분에 쓰는 문장 열 개', '일하는 영어', 10, 0),
      V('못 알아들었을 때 되묻는 법', '일하는 영어', 7, 1),
      V('말 끊지 않고 끼어드는 표현', '회의실 영어', 9, 1),
      V('의견을 두 문장으로 말하기', '회의실 영어', 12, 2),
      V('동의와 반대, 정도를 조절하는 말', '일하는 영어', 8, 2),
    ],
  },
  {
    key: 'run',
    title: '달리기 10km 완주하기',
    branches: ['주간 훈련 짜기', '호흡과 페이스', '부상 피하기'],
    rec: [[0, 2], [0, 1], [1]],
    vids: [
      V('주 3회로 짜는 8주 계획', '달리는 사람', 12, 0),
      V('쉬는 날을 어디에 넣을까', '달리는 사람', 6, 0),
      V('말할 수 있는 속도로 달리기', '러닝 교실', 9, 1),
      V('무릎이 아플 때 먼저 볼 것', '스포츠의학 노트', 11, 2),
      V('신발 고를 때 확인할 세 가지', '러닝 교실', 8, 2),
    ],
  },
  {
    key: 'py',
    title: '파이썬으로 데이터 다루기',
    branches: ['표 읽고 고르기', '지저분한 데이터 정리', '그래프 그리기'],
    rec: [
      [0, 1],
      [1, 2],
      [1, 2],
    ],
    vids: [
      V('CSV 파일 열고 훑어보기', '데이터 실습실', 10, 0),
      V('조건으로 행 골라내기', '데이터 실습실', 9, 0),
      V('빈칸과 중복 처리하기', '코드 한 줄씩', 13, 1),
      V('날짜 열 다루기', '코드 한 줄씩', 8, 1),
      V('막대와 선, 언제 무엇을 쓰나', '데이터 실습실', 11, 2),
    ],
  },
]);

/** The prototype's goal for typed text. */
export function fixtureCustomGoal(t: string): FixtureGoal {
  return {
    key: 'c' + t,
    title: t,
    branches: ['기본 개념', '실제 사례', '흔한 오해'],
    rec: [
      [0, 1],
      [1, 2],
      [1, 2],
    ],
    vids: [
      V(t + ' — 먼저 알아 둘 용어', '(예시 채널)', 9, 0),
      V(t + ' — 전체 흐름 한 번에', '(예시 채널)', 12, 0),
      V(t + ' — 실제 사례 하나', '(예시 채널)', 10, 1),
      V(t + ' — 사례에서 놓치기 쉬운 것', '(예시 채널)', 8, 1),
      V(t + ' — 자주 틀리는 생각', '(예시 채널)', 7, 2),
    ],
  };
}

export interface FixtureHistoryRow {
  t: string;
  meta: string;
  /** Index into FIXTURE_GOALS. */
  g: number;
}

export const FIXTURE_HISTORY: readonly FixtureHistoryRow[] = Object.freeze([
  { t: '영어 회의에서 말문 트기', meta: '10월 28일 · 12편', g: 1 },
  { t: '달리기 10km 완주하기', meta: '10월 14일 · 8편', g: 2 },
]);

/** The prototype's header date (day 1). */
export const FIXTURE_DATE_LABEL = '11월 10일 화요일';
/** What the prototype fills in when its insight screen opens with no reactions. */
export const FIXTURE_DEFAULT_REACTS: readonly FixtureReact[] = Object.freeze([
  'like',
  'like',
  'skip',
  'dislike',
  'like',
]);
/** The prototype's preset for opening 시청 / 인사이트 directly. */
export const FIXTURE_PRESET = Object.freeze({ goal: 0, level: 0, sel: [0, 1, 2, 3] });
/** History rows open the goal with this level and these branches (prototype). */
export const FIXTURE_HISTORY_PRESET = Object.freeze({ level: 1, sel: [0, 1, 2] });

/** Today's list = the goal's videos in the chosen branches; all of them when none match. */
export function fixtureVids(goal: FixtureGoal | null, sel: readonly number[]): FixtureVideo[] {
  if (!goal) return [];
  const f = goal.vids.filter((v) => sel.includes(v.br));
  return f.length ? f : goal.vids;
}

/** The prototype's `v` for one video, its stand-in texts included. */
export function fixtureItemView(
  goal: FixtureGoal,
  level: number | null,
  v: FixtureVideo,
  index: number
): WatchItemView {
  const br = goal.branches[v.br] ?? '';
  return {
    key: goal.key + ':' + index,
    title: v.t,
    meta: v.ch + ' · ' + v.min + '분 · ' + br,
    summary: v.sum || '"' + br + '" 갈래에서 고른 영상입니다. (예시 데이터: 요약 미작성)',
    reasonLines: [
      v.why || '"' + WATCH_LEVELS[level ?? 0] + '"라고 하셔서 이 수준에 맞는 설명을 골랐습니다.',
    ],
    checks: (v.checks || ['진행자 1명', '한국어 음성']).map((c) => ({ text: '✓ ' + c, ok: true })),
    chapters: (v.pts || []).map(([at, title]) => ({ at, title })),
  };
}

/** Player length label of the placeholder: 'min:00'. */
export function fixtureDuration(v: FixtureVideo): string {
  return v.min + ':00';
}

const PERCENT = 100;

/** The prototype's insight numbers, rows and bars for the reactions given. */
export function fixtureInsight(
  goal: FixtureGoal,
  vids: readonly FixtureVideo[],
  reacts: readonly FixtureReact[]
): InsightView {
  const n = vids.length;
  const R = reacts.slice(0, n);
  const seen = vids.filter((_x, i) => R[i] && R[i] !== 'skip');
  const mins = seen.reduce((a, x) => a + x.min, 0);
  const likes = R.filter((r) => r === 'like').length;
  const skips = R.filter((r) => r === 'skip').length;
  const byBr = new Map<number, number>();
  seen.forEach((x) => byBr.set(x.br, (byBr.get(x.br) ?? 0) + x.min));
  const minsOf = (k: number): number => byBr.get(k) ?? 0;
  const keys = [...byBr.keys()].sort((a, b) => a - b).sort((a, b) => minsOf(b) - minsOf(a));
  const maxB = Math.max(1, ...byBr.values());
  return {
    paragraph: buildWatchSummary({
      received: n,
      watched: seen.length,
      minutes: mins,
      topBranch: keys.length ? (goal.branches[keys[0]] ?? null) : null,
      likes,
      skips,
    }),
    stats: [
      { k: '본 영상', v: seen.length, u: '편' },
      { k: '본 시간', v: mins, u: '분' },
      { k: '좋아', v: likes, u: '편' },
    ],
    rows: vids.map((x, i): InsightRowView => {
      const r = R[i];
      return {
        key: String(i),
        title: x.t,
        tag:
          r === 'like'
            ? '좋아 · ' + x.min + '분'
            : r === 'dislike'
              ? '별로 · ' + x.min + '분'
              : '넘김',
        kind: r === 'like' ? 'like' : r === 'dislike' ? 'dislike' : 'pass',
      };
    }),
    bars: keys.map((k) => ({
      label: goal.branches[k] ?? '',
      min: minsOf(k),
      minText: minsOf(k) + '분',
      pct: Math.round((minsOf(k) / maxB) * PERCENT),
    })),
  };
}
