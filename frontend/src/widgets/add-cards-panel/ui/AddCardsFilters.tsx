/**
 * Add Cards filter rows (CP466 amendment — YouTube-style chip selection).
 *
 * 3 facets stacked as horizontal chip rows (label + chip group), each
 * facet behaves as a single-select radio. Clicking a non-"All" chip
 * sets the facet; clicking the active chip or "All" chip clears it.
 *
 * Spec: docs/design/add-cards-2026-05-18.md §5 Filter semantics +
 * CP466 user directive 2026-05-18 "유튜브 식 칩 선택".
 */

import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/utils';
import { useAddCardsPanelStore } from '../model/useAddCardsPanelStore';
import type { DurationBucket } from '../model/useAddCards';

const MS_PER_DAY = 86_400_000;

type FacetPreset<V extends string> = {
  value: V;
  labelKey: string;
  defaultLabel: string;
};

const VIEW_COUNT_PRESETS: ReadonlyArray<FacetPreset<string>> = [
  { value: '', labelKey: 'addCards.filters.viewCount.all', defaultLabel: 'All' },
  { value: '1000', labelKey: 'addCards.filters.viewCount.1k', defaultLabel: '1K+' },
  { value: '10000', labelKey: 'addCards.filters.viewCount.10k', defaultLabel: '10K+' },
  { value: '100000', labelKey: 'addCards.filters.viewCount.100k', defaultLabel: '100K+' },
  { value: '1000000', labelKey: 'addCards.filters.viewCount.1m', defaultLabel: '1M+' },
];

const DURATION_PRESETS: ReadonlyArray<FacetPreset<'' | DurationBucket>> = [
  { value: '', labelKey: 'addCards.filters.duration.all', defaultLabel: 'Any' },
  { value: 'short', labelKey: 'addCards.filters.duration.short', defaultLabel: '< 10m' },
  { value: 'medium', labelKey: 'addCards.filters.duration.medium', defaultLabel: '10–30m' },
  { value: 'long', labelKey: 'addCards.filters.duration.long', defaultLabel: '30–60m' },
  { value: 'xlong', labelKey: 'addCards.filters.duration.xlong', defaultLabel: '≥ 60m' },
];

const PUBLISHED_PRESETS: ReadonlyArray<FacetPreset<string>> = [
  { value: '', labelKey: 'addCards.filters.published.all', defaultLabel: 'Any' },
  { value: '7', labelKey: 'addCards.filters.published.7d', defaultLabel: '1w' },
  { value: '30', labelKey: 'addCards.filters.published.30d', defaultLabel: '1mo' },
  { value: '180', labelKey: 'addCards.filters.published.180d', defaultLabel: '6mo' },
  { value: '365', labelKey: 'addCards.filters.published.365d', defaultLabel: '1yr' },
];

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * MS_PER_DAY).toISOString();
}

function isoToDaysBucket(iso: string): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return '';
  const days = Math.round((Date.now() - ts) / MS_PER_DAY);
  if (days <= 8) return '7';
  if (days <= 31) return '30';
  if (days <= 181) return '180';
  return '365';
}

interface ChipRowProps<V extends string> {
  label: string;
  presets: ReadonlyArray<FacetPreset<V>>;
  selectedValue: V;
  onSelect: (value: V) => void;
}

function ChipRow<V extends string>({ label, presets, selectedValue, onSelect }: ChipRowProps<V>) {
  return (
    <div className="flex items-center gap-2 px-4 py-1.5">
      <span className="shrink-0 text-[10.5px] uppercase tracking-wider text-muted-foreground w-[68px]">
        {label}
      </span>
      <div className="flex-1 flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {presets.map((p) => {
          const isActive = p.value === selectedValue;
          return (
            <button
              key={p.value}
              type="button"
              onClick={() => onSelect(p.value)}
              aria-pressed={isActive}
              className={cn(
                'shrink-0 inline-flex items-center h-7 rounded-full border px-3 text-[11.5px] font-medium transition-colors',
                isActive
                  ? 'bg-foreground text-background border-foreground'
                  : 'bg-transparent text-foreground/80 border-border/50 hover:border-border hover:bg-foreground/[0.04]'
              )}
            >
              {p.defaultLabel /* fallback shown if i18n key missing */}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function AddCardsFilters() {
  const { t } = useTranslation();
  const filters = useAddCardsPanelStore((s) => s.filters);
  const setFilters = useAddCardsPanelStore((s) => s.setFilters);

  const minViewsValue = filters.minViewCount != null ? String(filters.minViewCount) : '';
  const durationValue: '' | DurationBucket = filters.durationBucket ?? '';
  const publishedDaysValue = filters.publishedAfter ? isoToDaysBucket(filters.publishedAfter) : '';

  // i18n wrapper around defaultLabel — translation falls back to defaultLabel.
  const tr = (preset: FacetPreset<string>): string =>
    t(preset.labelKey, preset.defaultLabel) as string;

  // Build presets with translated labels rendered (defaultLabel shown
  // only as TS-level fallback).
  const viewPresetsTr = VIEW_COUNT_PRESETS.map((p) => ({ ...p, defaultLabel: tr(p) }));
  const durationPresetsTr = DURATION_PRESETS.map((p) => ({
    ...p,
    defaultLabel: tr(p as FacetPreset<string>),
  }));
  const publishedPresetsTr = PUBLISHED_PRESETS.map((p) => ({ ...p, defaultLabel: tr(p) }));

  return (
    <div className="py-1 space-y-0.5">
      <ChipRow
        label={t('addCards.filters.viewCount.label', 'Views')}
        presets={viewPresetsTr}
        selectedValue={minViewsValue}
        onSelect={(v) => {
          if (v === '') {
            const { minViewCount: _drop, ...rest } = filters;
            void _drop;
            setFilters(rest);
          } else {
            setFilters({ ...filters, minViewCount: Number(v) });
          }
        }}
      />
      <ChipRow
        label={t('addCards.filters.duration.label', 'Length')}
        presets={durationPresetsTr}
        selectedValue={durationValue}
        onSelect={(v) => {
          if (v === '') {
            const { durationBucket: _drop, ...rest } = filters;
            void _drop;
            setFilters(rest);
          } else {
            setFilters({ ...filters, durationBucket: v as DurationBucket });
          }
        }}
      />
      <ChipRow
        label={t('addCards.filters.published.label', 'Published')}
        presets={publishedPresetsTr}
        selectedValue={publishedDaysValue}
        onSelect={(v) => {
          if (v === '') {
            const { publishedAfter: _drop, ...rest } = filters;
            void _drop;
            setFilters(rest);
          } else {
            setFilters({ ...filters, publishedAfter: daysAgoIso(Number(v)) });
          }
        }}
      />
    </div>
  );
}
