import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';
import { useRecommendations, type RecommendationItem } from '../model/useRecommendations';
import { useVideoStream } from '../model/useVideoStream';
import { FeedCard } from './FeedCard';

interface RecommendationFeedProps {
  mandalaId: string;
  subLabels: string[];
  /** Existing user-added cards by cell — only .length is read for empty-state copy. */
  cardsByCell: Record<number, readonly unknown[]>;
}

const CELL_COUNT = 8;
const SKELETON_PLACEHOLDER_COUNT = 3;
const RELATIVE_HOUR_THRESHOLD = 60;
const RELATIVE_DAY_THRESHOLD = 24;

// Grid (visual 9-cell layout) → subject index, mirrors InsightsView GRID_TO_SUBJECT
const SUBJECT_INDICES = [0, 1, 2, 3, 4, 5, 6, 7] as const;

function formatRelative(iso: string | null): string {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < RELATIVE_HOUR_THRESHOLD) return `${minutes}m`;
  const hours = Math.floor(minutes / RELATIVE_HOUR_THRESHOLD);
  if (hours < RELATIVE_DAY_THRESHOLD) return `${hours}h`;
  const days = Math.floor(hours / RELATIVE_DAY_THRESHOLD);
  return `${days}d`;
}

type CellFilter = 'all' | number;

export function RecommendationFeed({ mandalaId, subLabels, cardsByCell }: RecommendationFeedProps) {
  const { t } = useTranslation();
  const { recommendations, isLoading, isError, refetch } = useRecommendations(mandalaId);
  const stream = useVideoStream(mandalaId);
  const [filter, setFilter] = useState<CellFilter>('all');

  // Merge polled and streamed items. Polling carries the
  // authoritative cache view (including older rows and cellLabel
  // resolved server-side); the SSE stream adds live-arriving rows
  // the polling hasn't fetched yet. Dedupe by id — stream events
  // win position (they arrived first in time).
  const items = useMemo<RecommendationItem[]>(() => {
    const polled = recommendations?.items ?? [];
    if (stream.cards.length === 0) return polled;
    const seen = new Set<string>();
    const merged: RecommendationItem[] = [];
    for (const s of stream.cards) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      merged.push(s);
    }
    for (const p of polled) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      merged.push(p);
    }
    return merged;
  }, [recommendations?.items, stream.cards]);

  // Per-cell counts: prefer rec items, fall back to existing user cards count.
  const counts = useMemo(() => {
    const map = new Map<number, number>();
    for (const item of items) {
      if (item.cellIndex != null && item.cellIndex >= 0 && item.cellIndex < CELL_COUNT) {
        map.set(item.cellIndex, (map.get(item.cellIndex) ?? 0) + 1);
      }
    }
    return map;
  }, [items]);

  const filtered = useMemo(() => {
    if (filter === 'all') return items;
    return items.filter((it: RecommendationItem) => it.cellIndex === filter);
  }, [items, filter]);

  // Total user cards across all cells — used for action-oriented empty state copy
  const totalUserCards = useMemo(
    () => Object.values(cardsByCell).reduce((sum, list) => sum + list.length, 0),
    [cardsByCell]
  );

  return (
    <section className="bg-surface-mid border border-border/50 rounded-xl p-4 space-y-3">
      {/* Header */}
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles className="w-3.5 h-3.5 text-primary shrink-0" />
          <h3 className="text-[13px] font-medium text-foreground truncate">
            {t('insights.recommendationFeed', 'My learning feed')}
          </h3>
        </div>
        {recommendations?.lastRefreshed && (
          <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
            {t('insights.lastRefreshed', '{{time}} ago', {
              time: formatRelative(recommendations.lastRefreshed),
            })}
          </span>
        )}
      </header>

      {/* Cell pill nav (always visible if data path is healthy — even with 0 items so user
          sees the structure). Hidden only on hard error. */}
      {!isError && (
        <nav
          className="flex items-center gap-1.5 overflow-x-auto -mx-1 px-1 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          aria-label="Recommendation feed cell filter"
        >
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1 rounded-md border text-[11px] font-semibold transition-colors ${
              filter === 'all'
                ? 'bg-primary/10 border-primary/60 text-primary'
                : 'bg-transparent border-border/60 text-muted-foreground hover:border-border hover:text-foreground'
            }`}
          >
            {t('insights.recFeedAllCells', 'All')}
            {items.length > 0 && (
              <span className="text-[9px] font-bold opacity-60 tabular-nums">{items.length}</span>
            )}
          </button>
          {SUBJECT_INDICES.map((idx) => {
            const label = subLabels[idx] || `${idx + 1}`;
            const count = counts.get(idx) ?? 0;
            const isSelected = filter === idx;
            return (
              <button
                key={idx}
                type="button"
                onClick={() => setFilter(idx)}
                className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1 rounded-md border text-[11px] font-semibold transition-colors ${
                  isSelected
                    ? 'bg-primary/10 border-primary/60 text-primary'
                    : 'bg-transparent border-border/60 text-muted-foreground hover:border-border hover:text-foreground'
                }`}
                title={label}
              >
                <span className="truncate max-w-[80px]">{label}</span>
                {count > 0 && (
                  <span className="text-[9px] font-bold opacity-60 tabular-nums">{count}</span>
                )}
              </button>
            );
          })}
        </nav>
      )}

      {/* Body */}
      {isLoading ? (
        <ul className="space-y-2">
          {Array.from({ length: SKELETON_PLACEHOLDER_COUNT }).map((_, i) => (
            <li
              key={i}
              className="h-[78px] rounded-lg bg-surface-low border border-border/40 animate-pulse"
            />
          ))}
        </ul>
      ) : isError ? (
        <div className="flex items-center justify-between gap-2 px-3 py-3 text-[11px] text-muted-foreground">
          <span>{t('insights.recFeedError', 'Could not load recommendations.')}</span>
          <button
            type="button"
            onClick={() => refetch()}
            className="text-primary font-semibold hover:underline"
          >
            {t('common.retry', 'Retry')}
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <EmptyRecState totalUserCards={totalUserCards} />
      ) : (
        <ul className="space-y-2">
          {filtered.map((item) => (
            <li key={item.id}>
              <FeedCard item={item} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ── inline EmptyState (action-oriented, option C) ── */

function EmptyRecState({ totalUserCards }: { totalUserCards: number }) {
  const { t } = useTranslation();
  // Two flavors: brand-new mandala vs partially-filled
  const message =
    totalUserCards > 0
      ? t('insights.recFeedPreparingWithCards', {
          count: totalUserCards,
          defaultValue:
            "You've added {{count}} cards. Personalized recommendations will arrive soon.",
        })
      : t(
          'insights.recFeedPreparing',
          'Personalized recommendations are being prepared. In the meantime, try adding video cards to your mandala cells →'
        );

  return (
    <div className="flex items-start gap-3 px-3 py-4 rounded-lg bg-surface-low border border-dashed border-border/60">
      <Sparkles className="w-4 h-4 text-primary/70 shrink-0 mt-0.5" />
      <p className="text-[11.5px] leading-relaxed text-muted-foreground">{message}</p>
    </div>
  );
}
