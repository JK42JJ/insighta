import { useTranslation } from 'react-i18next';

import type { DashboardStats } from '@/shared/types/mandala-ux';

interface StatsGridProps {
  stats: DashboardStats;
}

const STAT_ITEMS = [
  { key: 'cells', labelKey: 'dashboard.stats.filledCells' },
  { key: 'videos', labelKey: 'dashboard.stats.videos' },
  { key: 'streak', labelKey: 'dashboard.stats.streak' },
  { key: 'relevance', labelKey: 'dashboard.stats.relevance' },
] as const;

export function StatsGrid({ stats }: StatsGridProps) {
  const { t } = useTranslation();
  const allZero =
    stats.filledCells === 0 &&
    stats.totalVideos === 0 &&
    stats.streakDays === 0 &&
    stats.avgRelevance === 0;

  const values: Record<string, React.ReactNode> = {
    cells: (
      <>
        {stats.filledCells}
        <small className="text-xs font-normal text-muted-foreground">/{stats.totalCells}</small>
      </>
    ),
    videos: stats.totalVideos,
    streak: (
      <>
        {stats.streakDays}
        <small className="text-xs font-normal text-muted-foreground">
          {t('dashboard.stats.days')}
        </small>
      </>
    ),
    relevance: (
      <>
        {stats.avgRelevance}
        <small className="text-xs font-normal text-muted-foreground">%</small>
      </>
    ),
  };

  return (
    <div className={`grid grid-cols-4 gap-2.5 ${allZero ? 'opacity-60' : ''}`}>
      {STAT_ITEMS.map(({ key, labelKey }) => (
        <div
          key={key}
          className={[
            'rounded-xl border bg-card p-4 text-center',
            allZero ? 'border-dashed border-border/60' : 'border-border',
          ].join(' ')}
        >
          <div className="text-[22px] font-black tracking-tighter">{values[key]}</div>
          <div className="mt-0.5 text-[10.5px] font-medium text-muted-foreground">
            {t(labelKey)}
          </div>
        </div>
      ))}
      {allZero && (
        <p className="col-span-4 mt-1 text-center text-[11px] font-semibold text-muted-foreground/50">
          {t('dashboard.stats.empty')}
        </p>
      )}
    </div>
  );
}
