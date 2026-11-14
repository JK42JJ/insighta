import type { InsightByCell, InsightData, InsightOrderItem } from '@/features/morning-cards/api';

const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const PERCENT = 100;

/** Minutes of one video, from watched seconds only. '' when unknown or nothing was watched. */
export function formatMinutes(watchedSeconds: number | null | undefined): string {
  if (watchedSeconds == null || !(watchedSeconds > 0)) return '';
  return Math.max(1, Math.round(watchedSeconds / SECONDS_PER_MINUTE)) + '분';
}

/** Total time: 1분 미만, N분, H시간 M분. '' when unknown. */
export function formatWatchTime(totalSeconds: number | null | undefined): string {
  if (totalSeconds == null || totalSeconds < 0) return '';
  if (totalSeconds < SECONDS_PER_MINUTE) return '1분 미만';
  const minutes = Math.round(totalSeconds / SECONDS_PER_MINUTE);
  if (minutes < MINUTES_PER_HOUR) return minutes + '분';
  const h = Math.floor(minutes / MINUTES_PER_HOUR);
  const m = minutes % MINUTES_PER_HOUR;
  return m > 0 ? h + '시간 ' + m + '분' : h + '시간';
}

/** Videos that were watched: passed ones are left out. */
export function watchedCount(d: Pick<InsightData, 'reacted' | 'passed'>): number {
  return Math.max(0, d.reacted - d.passed);
}

/** Summary paragraph from real numbers only. '' when nothing was reacted to. */
export function buildInsightSummary(d: InsightData): string {
  if (!(d.reacted > 0)) return '';
  const parts: string[] = [];
  parts.push(
    d.liked > 0
      ? '오늘 ' + d.reacted + '편에 반응했고, 그중 ' + d.liked + '편을 좋아했습니다.'
      : '오늘 ' + d.reacted + '편에 반응했습니다.'
  );
  const time = d.has_watch_data ? formatWatchTime(d.watched_seconds_total) : '';
  if (time && watchedCount(d) > 0) parts.push('본 시간은 ' + time + '입니다.');
  if (d.passed > 0) parts.push('넘긴 영상은 ' + d.passed + '편입니다.');
  return parts.join(' ');
}

const VERDICT_LABEL: Record<InsightOrderItem['verdict'], string> = {
  useful: '좋아',
  skip: '별로',
  pass: '넘김',
};

/** '좋아 · 11분' / '별로' / '넘김'. Minutes come only from watched seconds; passed rows never show them. */
export function orderRowText(item: InsightOrderItem): string {
  const label = VERDICT_LABEL[item.verdict];
  if (item.verdict === 'pass') return label;
  const min = formatMinutes(item.watched_seconds);
  return min ? label + ' · ' + min : label;
}

export interface CellBar {
  cell: string;
  text: string;
  /** 0..100, only in bar mode. */
  percent: number | null;
}

/**
 * Bars by watched seconds when the server has watch data, longest first. Without watch data
 * the cells are plain counts (no bars, no substituted video length).
 */
export function buildCellRows(d: Pick<InsightData, 'has_watch_data' | 'by_cell'>): CellBar[] {
  const secs = (c: InsightByCell) => c.watched_seconds ?? 0;
  const withTime = (c: InsightByCell) => secs(c) > 0;
  if (d.has_watch_data && d.by_cell.some(withTime)) {
    const rows = d.by_cell.filter(withTime).sort((a, b) => secs(b) - secs(a));
    const max = secs(rows[0]);
    return rows.map((c) => ({
      cell: c.cell,
      text: formatWatchTime(secs(c)),
      percent: Math.max(1, Math.round((secs(c) / max) * PERCENT)),
    }));
  }
  return d.by_cell
    .filter((c) => c.count > 0)
    .map((c) => ({ cell: c.cell, text: c.count + '편', percent: null }));
}
