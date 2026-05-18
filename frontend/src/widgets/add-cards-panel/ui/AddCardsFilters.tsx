/**
 * Add Cards filter row (CP466 amendment).
 *
 * 3 facets: minViewCount + durationBucket + publishedAfter.
 * Native <select> for v1 (no shadcn Select dependency). Each preset
 * has an "all" (no filter) sentinel — selecting it clears the facet.
 *
 * Spec: docs/design/add-cards-2026-05-18.md §5 Filter semantics.
 */

import { useTranslation } from 'react-i18next';
import { useAddCardsPanelStore } from '../model/useAddCardsPanelStore';
import type { DurationBucket } from '../model/useAddCards';

const VIEW_COUNT_PRESETS = [
  { value: '', labelKey: 'addCards.filters.viewCount.all', defaultLabel: 'All views' },
  { value: '1000', labelKey: 'addCards.filters.viewCount.1k', defaultLabel: '≥ 1K views' },
  { value: '10000', labelKey: 'addCards.filters.viewCount.10k', defaultLabel: '≥ 10K views' },
  { value: '100000', labelKey: 'addCards.filters.viewCount.100k', defaultLabel: '≥ 100K views' },
  { value: '1000000', labelKey: 'addCards.filters.viewCount.1m', defaultLabel: '≥ 1M views' },
] as const;

const DURATION_PRESETS: ReadonlyArray<{
  value: '' | DurationBucket;
  labelKey: string;
  defaultLabel: string;
}> = [
  { value: '', labelKey: 'addCards.filters.duration.all', defaultLabel: 'Any length' },
  { value: 'short', labelKey: 'addCards.filters.duration.short', defaultLabel: '< 10 min' },
  { value: 'medium', labelKey: 'addCards.filters.duration.medium', defaultLabel: '10–30 min' },
  { value: 'long', labelKey: 'addCards.filters.duration.long', defaultLabel: '30–60 min' },
  { value: 'xlong', labelKey: 'addCards.filters.duration.xlong', defaultLabel: '≥ 60 min' },
];

const PUBLISHED_PRESETS = [
  { value: '', labelKey: 'addCards.filters.published.all', defaultLabel: 'Any time' },
  { value: '7', labelKey: 'addCards.filters.published.7d', defaultLabel: 'Past week' },
  { value: '30', labelKey: 'addCards.filters.published.30d', defaultLabel: 'Past month' },
  { value: '180', labelKey: 'addCards.filters.published.180d', defaultLabel: 'Past 6 months' },
  { value: '365', labelKey: 'addCards.filters.published.365d', defaultLabel: 'Past year' },
] as const;

const MS_PER_DAY = 86_400_000;

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * MS_PER_DAY).toISOString();
}

const SELECT_CLASS =
  'flex-1 min-w-0 text-[12px] bg-background border border-border/60 rounded px-2 py-1.5 ' +
  'focus:outline-none focus:ring-2 focus:ring-primary/30 hover:border-border';

export function AddCardsFilters() {
  const { t } = useTranslation();
  const filters = useAddCardsPanelStore((s) => s.filters);
  const setFilters = useAddCardsPanelStore((s) => s.setFilters);

  // Reverse-map current filter value → preset select value.
  const minViewsValue = filters.minViewCount != null ? String(filters.minViewCount) : '';
  const durationValue = filters.durationBucket ?? '';
  // Date → days-ago bucket — closest preset, else '' (any time).
  const publishedDaysValue = (() => {
    if (!filters.publishedAfter) return '';
    const ts = Date.parse(filters.publishedAfter);
    if (!Number.isFinite(ts)) return '';
    const days = Math.round((Date.now() - ts) / MS_PER_DAY);
    if (days <= 8) return '7';
    if (days <= 31) return '30';
    if (days <= 181) return '180';
    return '365';
  })();

  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b border-border/40">
      <select
        value={minViewsValue}
        onChange={(e) => {
          const v = e.target.value;
          if (v === '') {
            const { minViewCount: _drop, ...rest } = filters;
            void _drop;
            setFilters(rest);
          } else {
            setFilters({ ...filters, minViewCount: Number(v) });
          }
        }}
        className={SELECT_CLASS}
        aria-label={t('addCards.filters.viewCount.label', 'Views')}
      >
        {VIEW_COUNT_PRESETS.map((p) => (
          <option key={p.value} value={p.value}>
            {t(p.labelKey, p.defaultLabel)}
          </option>
        ))}
      </select>
      <select
        value={durationValue}
        onChange={(e) => {
          const v = e.target.value;
          if (v === '') {
            const { durationBucket: _drop, ...rest } = filters;
            void _drop;
            setFilters(rest);
          } else {
            setFilters({ ...filters, durationBucket: v as DurationBucket });
          }
        }}
        className={SELECT_CLASS}
        aria-label={t('addCards.filters.duration.label', 'Length')}
      >
        {DURATION_PRESETS.map((p) => (
          <option key={p.value} value={p.value}>
            {t(p.labelKey, p.defaultLabel)}
          </option>
        ))}
      </select>
      <select
        value={publishedDaysValue}
        onChange={(e) => {
          const v = e.target.value;
          if (v === '') {
            const { publishedAfter: _drop, ...rest } = filters;
            void _drop;
            setFilters(rest);
          } else {
            setFilters({ ...filters, publishedAfter: daysAgoIso(Number(v)) });
          }
        }}
        className={SELECT_CLASS}
        aria-label={t('addCards.filters.published.label', 'Published')}
      >
        {PUBLISHED_PRESETS.map((p) => (
          <option key={p.value} value={p.value}>
            {t(p.labelKey, p.defaultLabel)}
          </option>
        ))}
      </select>
    </div>
  );
}
