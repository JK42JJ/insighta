/*
 * Watch flow (/morning-cards?view=watch), design handoff "design_handoff_insighta_mobile":
 * view models and pure text builders for the 02 입력 / 03 시청 / 04 인사이트 screens. No React,
 * so all of it is unit tested. Copy follows the handoff word for word.
 */
import type { FeedHistoryItem, InsightData } from '@/features/morning-cards/api';
import { orderRowText } from '@/features/morning-feed/insight-summary';

/** 수준 buttons, in the handoff order. */
export const WATCH_LEVELS: readonly string[] = Object.freeze([
  '처음 배웁니다',
  '조금 알고 있습니다',
  '일이나 생활에서 이미 쓰고 있습니다',
]);

/** A goal as the input screen shows it: title, its branches and the preselected ones per level. */
export interface WatchGoal {
  key: string;
  title: string;
  branches: string[];
  /** Per level (0..2): the branch indexes selected when that level is picked. */
  rec: number[][];
}

/** One video as the 시청 screen draws it. A block whose data is missing stays empty. */
export interface WatchItemView {
  key: string;
  title: string;
  meta: string;
  summary: string;
  reasonLines: string[];
  checks: Array<{ text: string; ok: boolean }>;
  chapters: Array<{ at: string; title: string }>;
}

export type WatchReaction = 'like' | 'dislike' | 'pass';

export interface InsightRowView {
  key: string;
  title: string;
  tag: string;
  kind: WatchReaction;
}

export interface InsightBarView {
  label: string;
  min: number;
  /** The bar's time as written ('9분', '1분 미만'). */
  minText: string;
  /** 0..100 */
  pct: number;
}

export interface InsightStatView {
  k: string;
  v: number;
  u: string;
}

export interface InsightView {
  paragraph: string;
  stats: InsightStatView[];
  rows: InsightRowView[];
  bars: InsightBarView[];
}

const KST_OFFSET_HOURS = 9;
const HOURS_IN_DAY = 24;
const MS_IN_HOUR = 3_600_000;
const MS_IN_DAY = HOURS_IN_DAY * MS_IN_HOUR;
const KST_OFFSET_MS = KST_OFFSET_HOURS * MS_IN_HOUR;
const SECONDS_IN_MINUTE = 60;
const PERCENT = 100;
const WEEKDAYS = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'] as const;
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The KST calendar day containing `now`, shifted by `offsetDays`, as 'YYYY-MM-DD'. */
export function kstDay(now: Date, offsetDays = 0): string {
  return new Date(now.getTime() + KST_OFFSET_MS + offsetDays * MS_IN_DAY)
    .toISOString()
    .slice(0, 10);
}

/** Header date in KST: '11월 10일 화요일'. */
export function kstDateLabel(now: Date): string {
  const k = new Date(now.getTime() + KST_OFFSET_MS);
  return k.getUTCMonth() + 1 + '월 ' + k.getUTCDate() + '일 ' + WEEKDAYS[k.getUTCDay()];
}

/** "이전 주제" right-hand text: '10월 28일 · 12편'. '' when the day is not 'YYYY-MM-DD'. */
export function historyMetaText(day: string, count: number): string {
  const m = DAY_RE.exec(day);
  if (!m) return '';
  return Number(m[2]) + '월 ' + Number(m[3]) + '일 · ' + count + '편';
}

/**
 * "어제에 이어서": the first history row (newest first) from yesterday (KST) whose goal can
 * continue today (`canContinue`, default: any) — otherwise null.
 */
export function carryCandidate(
  history: readonly FeedHistoryItem[],
  now: Date,
  canContinue: (cellLabel: string) => boolean = () => true
): FeedHistoryItem | null {
  const yesterday = kstDay(now, -1);
  return history.find((h) => h.day === yesterday && canContinue(h.cell)) ?? null;
}

/** Chapter time as the handoff writes it: two-digit minutes ('3:10' -> '03:10'). */
export function chapterStamp(at: string): string {
  return /^\d:\d\d$/.test(at) ? '0' + at : at;
}

export interface WatchSummaryInput {
  /** Videos received today for the goal. */
  received: number;
  /** Of those, the ones watched (passed ones left out). */
  watched: number;
  /** Minutes watched; null when unknown. */
  minutes: number | null;
  /** Watched time as written ('42분', '1분 미만'); overrides `minutes` in the sentence when set. */
  minutesText?: string | null;
  /** The branch with the most watched time; null when unknown. */
  topBranch: string | null;
  likes: number;
  /** Videos passed (넘기기). */
  skips: number;
}

/**
 * The 04 인사이트 paragraph, the handoff formula: "오늘 받은 n편 가운데 m편을 봤고 t분을 썼습니다.
 * 가장 오래 본 갈래는 "…"입니다. 좋다고 한 영상은 k편입니다. 넘긴 영상은 j편입니다." A part is left
 * out only when its data is missing (no minutes -> "…m편을 봤습니다."; no top branch / no likes ->
 * no sentence). The last sentence states the fact only: nothing replaces passed videos.
 */
export function buildWatchSummary(s: WatchSummaryInput): string {
  const head = '오늘 받은 ' + s.received + '편 가운데 ' + s.watched + '편을 ';
  const first =
    s.minutes === null
      ? head + '봤습니다. '
      : head + '봤고 ' + (s.minutesText ?? s.minutes + '분') + '을 썼습니다. ';
  return (
    first +
    (s.topBranch ? '가장 오래 본 갈래는 "' + s.topBranch + '"입니다. ' : '') +
    (s.likes ? '좋다고 한 영상은 ' + s.likes + '편입니다. ' : '') +
    (s.skips ? '넘긴 영상은 ' + s.skips + '편입니다.' : '넘긴 영상은 없습니다.')
  );
}

const UNDER_A_MINUTE = '1분 미만';

/**
 * Watched time as text: under a minute (but some) -> '1분 미만', otherwise rounded minutes. Never
 * rounds a few seconds up to '1분'. null/0/invalid -> null.
 */
export function minutesText(seconds: number | null | undefined): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null;
  if (seconds < SECONDS_IN_MINUTE) return UNDER_A_MINUTE;
  return Math.round(seconds / SECONDS_IN_MINUTE) + '분';
}

/** Whole minutes from seconds, null stays null. */
export function wholeMinutes(seconds: number | null | undefined): number | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null;
  return Math.round(seconds / SECONDS_IN_MINUTE);
}

/** A 본 순서 row's right text: the verdict label, then the watched time unless passed or unknown. */
export function watchRowText(o: InsightData['order'][number]): string {
  const label = orderRowText({ ...o, watched_seconds: null });
  if (o.verdict === 'pass') return label;
  const t = minutesText(o.watched_seconds);
  return t ? label + ' · ' + t : label;
}

const VERDICT_KIND: Record<string, WatchReaction> = {
  useful: 'like',
  skip: 'dislike',
  pass: 'pass',
};

/**
 * 04 인사이트 from the server's per-goal summary. received = the batch size when the server sends
 * it (watch screen), else every video answered today (pass included); watched = the ones not
 * passed (the server's `reacted`), minutes = watched seconds of those (passed videos never count).
 * The time chip, the minutes and the bars are left out when the server has no watch data.
 */
export function insightViewFromData(
  d: InsightData,
  shortOf: (cellLabel: string) => string
): InsightView {
  const minutes = d.has_watch_data ? wholeMinutes(d.watched_seconds_total) : null;
  const timed = d.has_watch_data
    ? d.by_cell
        .filter((c) => (c.watched_seconds ?? 0) > 0)
        .sort((a, b) => (b.watched_seconds ?? 0) - (a.watched_seconds ?? 0))
    : [];
  const max = Math.max(1, ...timed.map((c) => c.watched_seconds ?? 0));
  const stats: InsightStatView[] = [{ k: '본 영상', v: d.reacted, u: '편' }];
  const total = d.has_watch_data ? d.watched_seconds_total : null;
  const underMinute = total != null && total > 0 && total < SECONDS_IN_MINUTE;
  if (minutes !== null)
    stats.push({ k: '본 시간', v: underMinute ? 1 : minutes, u: underMinute ? '분 미만' : '분' });
  stats.push({ k: '좋아', v: d.liked, u: '편' });
  return {
    paragraph: buildWatchSummary({
      received: d.received ?? d.reacted + d.passed,
      watched: d.reacted,
      minutes,
      minutesText: minutesText(total),
      topBranch: timed[0] ? shortOf(timed[0].cell) : null,
      likes: d.liked,
      skips: d.passed,
    }),
    stats,
    rows: d.order.map((o, k) => ({
      key: o.video_id + k,
      title: o.title ?? '',
      tag: watchRowText(o),
      kind: VERDICT_KIND[o.verdict] ?? 'pass',
    })),
    bars: timed.map((c) => ({
      label: shortOf(c.cell),
      min: wholeMinutes(c.watched_seconds) ?? 0,
      minText: minutesText(c.watched_seconds) ?? '0분',
      pct: Math.round(((c.watched_seconds ?? 0) / max) * PERCENT),
    })),
  };
}

/** This device has seen 01 온보딩 (localStorage). */
export const WATCH_ONB_SEEN_KEY = 'mf_watch_onb_seen';

/** False when storage is empty, blocked or throws: the onboarding then shows (and still works). */
export function readOnboardingSeen(): boolean {
  try {
    return window.localStorage.getItem(WATCH_ONB_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeOnboardingSeen(): void {
  try {
    window.localStorage.setItem(WATCH_ONB_SEEN_KEY, '1');
  } catch {
    /* private mode: the onboarding shows again next visit */
  }
}
