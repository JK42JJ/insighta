import { useEffect, useState } from 'react';

import { fetchMorningFeedInsight, type InsightData } from '@/features/morning-cards/api';
import { cssText as css } from '@/features/morning-feed/css-text';
import {
  buildCellRows,
  buildInsightSummary,
  formatWatchTime,
  orderRowText,
  watchedCount,
} from '@/features/morning-feed/insight-summary';

const CHIP =
  'flex: 1; min-width: 0; border-radius: 14px; background: var(--mf-fit); padding: 12px 14px; display: flex; flex-direction: column; gap: 4px';
const SECTION_LABEL = 'font-size: 13px; font-weight: 700; color: var(--mf-muted)';

/**
 * 오늘 본 것. Loaded when the done screen shows; while loading and on failure nothing is drawn,
 * so the done screen is never blocked or left with an error.
 */
export function InsightSection({ enabled }: { enabled: boolean }) {
  const [data, setData] = useState<InsightData | null>(null);
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    fetchMorningFeedInsight()
      .then((d) => alive && setData(d))
      .catch(() => alive && setData(null));
    return () => {
      alive = false;
    };
  }, [enabled]);

  if (!enabled || !data || !(data.reacted > 0)) return null;
  const summary = buildInsightSummary(data);
  const time = data.has_watch_data ? formatWatchTime(data.watched_seconds_total) : '';
  const rows = buildCellRows(data);
  const chips: Array<{ label: string; value: string }> = [
    { label: '본 영상', value: watchedCount(data) + '편' },
    ...(time ? [{ label: '본 시간', value: time }] : []),
    { label: '좋아', value: data.liked + '편' },
  ];
  return (
    <div
      data-testid="mf-insight"
      style={css('display: flex; flex-direction: column; gap: 18px; padding-top: 6px')}
    >
      <div style={css('font-size: 18px; font-weight: 700')}>오늘 본 것</div>
      {summary ? <div style={css('font-size: 15px; line-height: 1.7')}>{summary}</div> : null}
      <div style={css('display: flex; gap: 10px')}>
        {chips.map((c) => (
          <div key={c.label} style={css(CHIP)}>
            <span style={css('font-size: 12px; color: var(--mf-muted)')}>{c.label}</span>
            <span style={css('font-size: 17px; font-weight: 700')}>{c.value}</span>
          </div>
        ))}
      </div>
      {data.order.length > 0 ? (
        <div style={css('display: flex; flex-direction: column; gap: 10px')}>
          <span style={css(SECTION_LABEL)}>본 순서</span>
          {data.order.map((o, k) => (
            <div
              key={o.video_id + k}
              data-testid="mf-insight-row"
              style={css('display: flex; gap: 12px; align-items: center')}
            >
              <span
                style={{
                  ...css('flex: none; width: 10px; height: 10px; border-radius: 50%'),
                  boxSizing: 'border-box',
                  ...(o.verdict === 'useful'
                    ? { background: 'var(--mf-accent)' }
                    : o.verdict === 'skip'
                      ? { background: 'var(--mf-dot-skip)' }
                      : { border: '1.5px solid var(--mf-dot-skip)' }),
                }}
              />
              <div style={css('display: flex; flex-direction: column; gap: 2px; min-width: 0')}>
                <span style={css('font-size: 14px; line-height: 1.4')}>{o.title}</span>
                <span style={css('font-size: 12px; color: var(--mf-muted)')}>
                  {orderRowText(o)}
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {rows.length > 0 ? (
        <div
          data-testid="mf-insight-cells"
          style={css('display: flex; flex-direction: column; gap: 10px')}
        >
          <span style={css(SECTION_LABEL)}>
            {rows[0].percent != null ? '어디에 시간을 썼나' : '칸별로 본 영상'}
          </span>
          {rows.map((r) => (
            <div key={r.cell} style={css('display: flex; flex-direction: column; gap: 5px')}>
              <div style={css('display: flex; justify-content: space-between; font-size: 13px')}>
                <span>{r.cell}</span>
                <span style={css('color: var(--mf-muted)')}>{r.text}</span>
              </div>
              {r.percent != null ? (
                <div style={css('height: 8px; border-radius: 4px; background: var(--mf-surface)')}>
                  <div
                    style={{
                      height: 8,
                      borderRadius: 4,
                      background: 'var(--mf-accent)',
                      width: r.percent + '%',
                    }}
                  />
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
