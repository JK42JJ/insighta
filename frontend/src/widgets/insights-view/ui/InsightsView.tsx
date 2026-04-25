import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { InsightCard } from '@/entities/card/model/types';
import type { ViewMode } from '@/entities/user/model/types';
import { handleThumbnailError, handleThumbnailLoad } from '@/shared/lib/image-utils';
import { ViewSwitcher } from '@/features/view-mode';
import { RecommendationFeed } from '@/features/recommendation-feed/ui/RecommendationFeed';
import { formatRelativeDate } from '@/shared/lib/format-date';

interface InsightsViewProps {
  allCards: InsightCard[];
  scratchPadCards: InsightCard[];
  cardsByCell: Record<number, InsightCard[]>;
  totalCards: number;
  sectorSubjects: string[];
  /** 2-4 char short labels parallel to sectorSubjects. Falls back to sectorSubjects when missing. */
  sectorLabels?: string[];
  title: string;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  /** Optional — when provided, RecommendationFeed renders under the title row. */
  mandalaId?: string | null;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
const MEMO_RATE_WARN_THRESHOLD = 10;
const CONTENT_TYPE_GOOD_THRESHOLD = 3;
const SECTOR_DOMINANCE_THRESHOLD = 0.4;

const GRID_TO_SUBJECT: Record<number, number> = {
  0: 0,
  1: 1,
  2: 2,
  3: 3,
  5: 4,
  6: 5,
  7: 6,
  8: 7,
};

/** Choose the short label when available, otherwise the long subject text. */
function pickSectorLabel(subjects: string[], labels: string[] | undefined, idx: number): string {
  const short = labels?.[idx]?.trim();
  if (short && short.length > 0) return short;
  return subjects[idx] || `Sector ${idx + 1}`;
}

export function InsightsView({
  allCards,
  scratchPadCards,
  cardsByCell,
  totalCards: _totalCards,
  sectorSubjects,
  sectorLabels,
  title,
  viewMode,
  onViewModeChange,
  mandalaId,
}: InsightsViewProps) {
  const { t } = useTranslation();

  const all = useMemo(() => [...allCards, ...scratchPadCards], [allCards, scratchPadCards]);

  const stats = useMemo(() => {
    const withMemo = all.filter((c) => c.userNote?.trim()).length;
    const memoRate = all.length > 0 ? Math.round((withMemo / all.length) * 100) : 0;
    const typeSet = new Set(all.map((c) => c.linkType).filter(Boolean));
    const now = Date.now();
    const recentWeek = all.filter(
      (c) => now - new Date(c.createdAt).getTime() < SEVEN_DAYS_MS
    ).length;
    const prevWeek = all.filter((c) => {
      const age = now - new Date(c.createdAt).getTime();
      return age >= SEVEN_DAYS_MS && age < FOURTEEN_DAYS_MS;
    }).length;
    const withSummary = all.filter(
      (c) => c.videoSummary?.summary_en || c.videoSummary?.summary_ko
    ).length;
    const summaryRate = all.length > 0 ? Math.round((withSummary / all.length) * 100) : 0;

    return {
      total: all.length,
      withMemo,
      memoRate,
      types: typeSet,
      typeCount: typeSet.size,
      recentWeek,
      prevWeek,
      withSummary,
      summaryRate,
    };
  }, [all]);

  // Mandala count from unique mandalaIds
  const mandalaCount = useMemo(() => {
    const ids = new Set(all.map((c) => c.mandalaId).filter(Boolean));
    return Math.max(1, ids.size);
  }, [all]);

  // Sector data
  const sectorData = useMemo(() => {
    const sectors: { label: string; count: number; isIdeation?: boolean }[] = [];
    for (const [gridIdx, subIdx] of Object.entries(GRID_TO_SUBJECT)) {
      const cellCards = cardsByCell[Number(gridIdx)] ?? [];
      sectors.push({
        label: pickSectorLabel(sectorSubjects, sectorLabels, subIdx),
        count: cellCards.length,
      });
    }
    return sectors;
  }, [cardsByCell, sectorSubjects, sectorLabels]);

  const emptySectors = useMemo(() => sectorData.filter((s) => s.count === 0), [sectorData]);

  const maxSectorCount = useMemo(
    () => Math.max(1, ...sectorData.map((s) => s.count)),
    [sectorData]
  );

  // Content type breakdown
  const contentTypes = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const card of all) {
      const type = card.linkType || 'unknown';
      counts[type] = (counts[type] || 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => ({
        type,
        count,
        pct: all.length > 0 ? Math.round((count / all.length) * 100) : 0,
      }));
  }, [all]);

  // Dominant sector
  const dominantSector = useMemo(() => {
    if (all.length === 0) return null;
    const sorted = [...sectorData].sort((a, b) => b.count - a.count);
    const top = sorted[0];
    if (!top || top.count === 0) return null;
    const pct = Math.round((top.count / all.length) * 100);
    return pct >= SECTOR_DOMINANCE_THRESHOLD * 100 ? { ...top, pct } : null;
  }, [sectorData, all]);

  // Recent 8 cards
  const recentCards = useMemo(() => {
    return [...all]
      .sort((a, b) => {
        const aTime = (a.updatedAt ?? a.createdAt).getTime();
        const bTime = (b.updatedAt ?? b.createdAt).getTime();
        return bTime - aTime;
      })
      .slice(0, 8);
  }, [all]);

  // Empty state — preserve the original early-return condition + message,
  // but also render the recommendation feed so a brand-new mandala still shows
  // personalized guidance instead of an empty page.
  if (stats.total === 0) {
    return (
      <div className="flex-1 overflow-y-auto space-y-4">
        {mandalaId && (
          <RecommendationFeed
            mandalaId={mandalaId}
            subLabels={sectorSubjects}
            cardsByCell={cardsByCell}
          />
        )}
        <div className="flex items-center justify-center p-8">
          <p className="text-sm text-muted-foreground">{t('insights.noCards')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto space-y-4">
      {/* Context Header — title + card count + ViewSwitcher */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex items-center justify-center w-6 h-6 rounded bg-primary/10 text-primary text-[11px] font-semibold shrink-0">
            {title.charAt(0).toUpperCase()}
          </div>
          <h3 className="text-lg font-semibold leading-tight truncate">{title}</h3>
          <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
            {t('contextHeader.cardCount', '{{count}} cards', { count: stats.total })}
          </span>
        </div>
        <ViewSwitcher value={viewMode} onChange={onViewModeChange} />
      </div>

      {/* Layer 2: Personalized recommendation feed (CP356 — sits directly under
          the title row, above the stats grid). Hidden when no mandalaId. */}
      {mandalaId && (
        <RecommendationFeed
          mandalaId={mandalaId}
          subLabels={sectorSubjects}
          cardsByCell={cardsByCell}
        />
      )}

      {/* Row 1: Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label={t('insights.totalCards')}
          value={stats.total}
          sub={t('insights.acrossMandalas', { count: mandalaCount })}
        />
        <StatCard
          label={t('insights.memoRate')}
          value={`${stats.memoRate}%`}
          sub={t('insights.memoSub', { with: stats.withMemo, total: stats.total })}
          color={stats.memoRate < MEMO_RATE_WARN_THRESHOLD ? 'amber' : 'green'}
        />
        <StatCard
          label={t('insights.contentTypes')}
          value={stats.typeCount}
          sub={
            stats.typeCount <= 1
              ? t('insights.contentTypeSingleWarn')
              : t('insights.contentTypeGood', { count: stats.typeCount })
          }
          color={stats.typeCount < CONTENT_TYPE_GOOD_THRESHOLD ? 'amber' : 'green'}
        />
        <StatCard
          label={t('insights.thisWeek')}
          value={`+${stats.recentWeek}`}
          sub={t('insights.weekCompare', { prev: stats.prevWeek })}
          color={stats.recentWeek >= stats.prevWeek ? 'green' : 'amber'}
        />
      </div>

      {/* Alert: empty sectors */}
      {emptySectors.length > 0 && (
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-destructive/10 text-destructive text-xs leading-relaxed">
          <span className="font-bold text-sm shrink-0">!</span>
          <span>
            {emptySectors.map((s) => s.label).join(', ')}{' '}
            {emptySectors.length === 1
              ? t('insights.emptySectorAlert')
              : t('insights.emptySectorsAlert', { count: emptySectors.length })}
          </span>
        </div>
      )}

      {/* Row 2: Sector Balance + Actionable Insights (2-col) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Left: Sector Balance */}
        <section className="bg-surface-mid border border-border/50 rounded-xl p-4">
          <h3 className="text-[13px] font-medium text-foreground mb-3">
            {t('insights.sectorBalance')}
          </h3>
          <div className="space-y-1.5">
            {sectorData.map((sector) => (
              <div key={sector.label} className="flex items-center gap-2">
                <span
                  className={`w-16 text-[11px] truncate text-right shrink-0 ${
                    sector.count === 0 ? 'text-destructive' : 'text-muted-foreground'
                  }`}
                >
                  {sector.label}
                </span>
                <div className="flex-1 h-4 bg-muted rounded-sm overflow-hidden relative">
                  {sector.count > 0 ? (
                    <div
                      className="h-full bg-primary/60 rounded-sm"
                      style={{ width: `${(sector.count / maxSectorCount) * 100}%` }}
                    />
                  ) : (
                    <span className="absolute inset-0 flex items-center justify-center text-[9px] text-destructive/60">
                      empty
                    </span>
                  )}
                </div>
                <span
                  className={`w-8 text-[10px] text-right tabular-nums shrink-0 ${
                    sector.count === 0 ? 'text-destructive/60' : 'text-muted-foreground'
                  }`}
                >
                  {sector.count}
                </span>
              </div>
            ))}

            {/* Ideation separator */}
            <div className="border-t border-border/30 pt-1.5 mt-1">
              <div className="flex items-center gap-2">
                <span className="w-16 text-[11px] truncate text-right shrink-0 text-muted-foreground/60 italic">
                  {t('insights.ideation')}
                </span>
                <div className="flex-1 h-4 bg-amber-500/10 rounded-sm overflow-hidden">
                  {scratchPadCards.length > 0 && (
                    <div
                      className="h-full bg-amber-500/50 rounded-sm"
                      style={{
                        width: `${Math.max(2, (scratchPadCards.length / maxSectorCount) * 100)}%`,
                      }}
                    />
                  )}
                </div>
                <span className="w-8 text-[10px] text-right tabular-nums shrink-0 text-amber-500">
                  {scratchPadCards.length}
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* Right: Actionable Insights */}
        <section className="bg-surface-mid border border-border/50 rounded-xl p-4">
          <h3 className="text-[13px] font-medium text-foreground mb-3">
            {t('insights.actionableInsights')}
          </h3>
          <div className="space-y-2">
            {/* Warning: single content type */}
            {stats.typeCount <= 1 && (
              <AlertRow type="warn">
                {t('insights.alertContentDiversity', {
                  type: contentTypes[0]?.type || 'YouTube',
                })}
              </AlertRow>
            )}

            {/* Warning: low memo rate */}
            {stats.memoRate < MEMO_RATE_WARN_THRESHOLD && (
              <AlertRow type="warn">
                {t('insights.alertLowMemo', {
                  pct: 100 - stats.memoRate,
                })}
              </AlertRow>
            )}

            {/* Info: dominant sector */}
            {dominantSector && (
              <AlertRow type="info">
                {t('insights.alertDominantSector', {
                  sector: dominantSector.label,
                  count: dominantSector.count,
                  pct: dominantSector.pct,
                })}
              </AlertRow>
            )}

            {/* Info: ideation cards */}
            {scratchPadCards.length > 0 && (
              <AlertRow type="info">
                {t('insights.alertIdeationCards', {
                  count: scratchPadCards.length,
                })}
              </AlertRow>
            )}
          </div>

          {/* Content type donut */}
          <div className="mt-4">
            <h4 className="text-xs font-medium text-foreground mb-2">
              {t('insights.contentBreakdown')}
            </h4>
            <ContentDonut types={contentTypes} total={stats.total} />
          </div>
        </section>
      </div>

      {/* Row 3: Recent Activity + AI Readiness (2-col) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Left: Recent Activity */}
        <section className="bg-surface-mid border border-border/50 rounded-xl p-4">
          <h3 className="text-[13px] font-medium text-foreground mb-3">
            {t('insights.recentActivity')}
          </h3>
          <div className="space-y-0.5">
            {recentCards.map((card) => (
              <div
                key={card.id}
                className="flex items-center gap-2 py-1.5 border-b border-border/20 last:border-b-0"
              >
                {/* Thumbnail */}
                {card.thumbnail ? (
                  <img
                    src={card.thumbnail}
                    alt=""
                    className="w-9 h-6 rounded-sm object-cover shrink-0 bg-muted"
                    onError={handleThumbnailError}
                    onLoad={handleThumbnailLoad}
                  />
                ) : (
                  <div className="w-9 h-6 rounded-sm bg-muted flex items-center justify-center shrink-0">
                    <span className="text-[8px] text-muted-foreground">
                      {card.linkType?.slice(0, 3)?.toUpperCase() || 'URL'}
                    </span>
                  </div>
                )}
                <span className="flex-1 text-[11px] text-foreground truncate min-w-0">
                  {card.title}
                </span>
                <span className="text-[9px] text-muted-foreground shrink-0 tabular-nums">
                  {formatRelativeDate(card.publishedAt ?? card.createdAt)}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* Right: AI Readiness */}
        <section className="bg-surface-mid border border-border/50 rounded-xl p-4">
          <h3 className="text-[13px] font-medium text-foreground mb-3">
            {t('insights.aiReadiness')}
          </h3>

          {/* AI Summary Coverage */}
          <div className="mb-4">
            <div className="text-xs text-muted-foreground mb-1">
              {t('insights.aiSummaryCoverage')}
            </div>
            <div className="flex items-center gap-3 mb-1.5">
              <span
                className={`text-[28px] font-medium tabular-nums ${
                  stats.summaryRate >= 60 ? 'text-green-500' : 'text-amber-500'
                }`}
              >
                {stats.summaryRate}%
              </span>
              <span className="text-[11px] text-muted-foreground leading-tight">
                {t('insights.aiSummarySub', {
                  with: stats.withSummary,
                  total: stats.total,
                })}
              </span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${
                  stats.summaryRate >= 60 ? 'bg-green-500' : 'bg-amber-500'
                }`}
                style={{ width: `${stats.summaryRate}%` }}
              />
            </div>
          </div>

          {/* Embedding coverage — hidden until API available */}
          {/* Future: embedding coverage bar here */}

          <p className="text-[10px] text-muted-foreground/70 leading-relaxed mt-3">
            {t('insights.aiReadinessNote')}
          </p>
        </section>
      </div>
    </div>
  );
}

/* ── Sub-components ── */

function StatCard({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string | number;
  sub: string;
  color?: 'amber' | 'green';
}) {
  const valueColor =
    color === 'amber' ? 'text-amber-500' : color === 'green' ? 'text-green-500' : 'text-foreground';

  return (
    <div className="bg-surface-mid border border-border/50 rounded-xl p-3">
      <div className="text-[11px] text-muted-foreground mb-1">{label}</div>
      <div className={`text-[22px] font-medium tabular-nums ${valueColor}`}>{value}</div>
      <div className="text-[10px] text-muted-foreground/60 mt-0.5">{sub}</div>
    </div>
  );
}

function AlertRow({
  type,
  children,
}: {
  type: 'warn' | 'info' | 'danger';
  children: React.ReactNode;
}) {
  const styles = {
    warn: 'bg-amber-500/10 text-amber-500',
    info: 'bg-primary/10 text-primary',
    danger: 'bg-destructive/10 text-destructive',
  };
  const icons = { warn: '!', info: 'i', danger: '!' };

  return (
    <div
      className={`flex items-start gap-2 px-2.5 py-2 rounded-lg text-[11px] leading-relaxed ${styles[type]}`}
    >
      <span className="font-bold text-xs shrink-0 mt-px">{icons[type]}</span>
      <span>{children}</span>
    </div>
  );
}

const DONUT_COLORS = ['hsl(var(--primary))', '#639922', '#BA7517', '#D85A30', '#9b59b6'];

function ContentDonut({
  types,
  total,
}: {
  types: { type: string; count: number; pct: number }[];
  total: number;
}) {
  const RADIUS = 30;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

  // Build segments
  let offset = 0;
  const segments = types.map((t, i) => {
    const len = total > 0 ? (t.count / total) * CIRCUMFERENCE : 0;
    const seg = {
      ...t,
      dasharray: `${len} ${CIRCUMFERENCE - len}`,
      offset,
      color: DONUT_COLORS[i % DONUT_COLORS.length],
    };
    offset += len;
    return seg;
  });

  return (
    <div className="flex items-center gap-4">
      <svg width="72" height="72" viewBox="0 0 80 80" className="shrink-0">
        <circle cx="40" cy="40" r={RADIUS} fill="none" stroke="hsl(var(--muted))" strokeWidth="8" />
        {segments.map((seg, i) => (
          <circle
            key={i}
            cx="40"
            cy="40"
            r={RADIUS}
            fill="none"
            stroke={seg.color}
            strokeWidth="8"
            strokeDasharray={seg.dasharray}
            strokeDashoffset={-seg.offset}
            transform="rotate(-90 40 40)"
          />
        ))}
      </svg>
      <div className="text-[11px] text-muted-foreground space-y-1">
        {types.map((t, i) => (
          <div key={t.type} className={t.count === 0 ? 'text-muted-foreground/40' : ''}>
            <span
              className="inline-block w-2 h-2 rounded-sm mr-1.5"
              style={{
                background:
                  t.count > 0 ? DONUT_COLORS[i % DONUT_COLORS.length] : 'hsl(var(--muted))',
              }}
            />
            {t.type}: {t.count} ({t.pct}%)
          </div>
        ))}
        {/* Show missing types */}
        {!types.find((t) => t.type === 'article') && (
          <div className="text-muted-foreground/40">
            <span className="inline-block w-2 h-2 rounded-sm mr-1.5 bg-muted" />
            Article: 0
          </div>
        )}
        {!types.find((t) => t.type === 'pdf') && (
          <div className="text-muted-foreground/40">
            <span className="inline-block w-2 h-2 rounded-sm mr-1.5 bg-muted" />
            PDF: 0
          </div>
        )}
      </div>
    </div>
  );
}
