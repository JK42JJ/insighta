import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { LayoutGrid, FileText, Tag, TrendingUp, LayoutDashboard } from 'lucide-react';
import { InsightCard } from '@/types/mandala';
import { Skeleton } from '@/components/ui/skeleton';
import { ListRowSkeletonGroup } from '@/components/skeletons';
import { StatCard } from './StatCard';
import { SubjectRadarChart } from './SubjectRadarChart';
import { QualityBreakdown } from './QualityBreakdown';
import { RecentCardsFeed } from './RecentCardsFeed';

// ---------------------------------------------------------------------------
// DashboardSkeleton — loading placeholder matching the real layout
// ---------------------------------------------------------------------------

function StatCardSkeleton() {
  return (
    <div className="rounded-xl border bg-card p-4 flex items-start gap-3">
      <Skeleton className="h-10 w-10 rounded-lg shrink-0" />
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-7 w-12" />
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-4 p-1">
      {/* Row 1: Stat Card placeholders */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <StatCardSkeleton key={i} />
        ))}
      </div>

      {/* Row 2: Radar + Quality placeholders */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Skeleton className="h-64 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>

      {/* Row 3: Recent Cards placeholder */}
      <div className="rounded-xl border bg-card p-4 space-y-2">
        <Skeleton className="h-5 w-32 mb-3" />
        <ListRowSkeletonGroup count={5} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DashboardView
// ---------------------------------------------------------------------------

interface DashboardViewProps {
  cards: InsightCard[];
  cardsByCell: Record<number, InsightCard[]>;
  subjects: string[];
  onCardClick?: (card: InsightCard) => void;
  isLoading?: boolean;
}

export function DashboardView({
  cards,
  cardsByCell,
  subjects,
  onCardClick,
  isLoading,
}: DashboardViewProps) {
  const { t } = useTranslation();

  const stats = useMemo(() => {
    const withMemo = cards.filter((c) => c.userNote && c.userNote.trim().length > 0).length;
    const uniqueTypes = new Set(cards.map((c) => c.linkType).filter(Boolean));
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recentWeek = cards.filter((c) => new Date(c.createdAt).getTime() > weekAgo).length;

    return {
      total: cards.length,
      memoRate: cards.length > 0 ? `${Math.round((withMemo / cards.length) * 100)}%` : '0%',
      cardTypes: uniqueTypes.size,
      recentWeek,
    };
  }, [cards]);

  if (isLoading) {
    return <DashboardSkeleton />;
  }

  if (cards.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] text-muted-foreground gap-4">
        <LayoutDashboard className="h-12 w-12 opacity-40" />
        <div className="text-center">
          <p className="text-lg font-medium text-foreground">{t('viewMode.dashboard')}</p>
          <p className="text-sm">{t('dashboard.noCards')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-1">
      {/* Row 1: Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={LayoutGrid} label={t('dashboard.totalCardsLabel')} value={stats.total} />
        <StatCard icon={FileText} label={t('dashboard.memoRate')} value={stats.memoRate} />
        <StatCard icon={Tag} label={t('dashboard.cardTypes')} value={stats.cardTypes} />
        <StatCard icon={TrendingUp} label={t('dashboard.recentWeek')} value={stats.recentWeek} />
      </div>

      {/* Row 2: Radar + Quality */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <SubjectRadarChart subjects={subjects} cardsByCell={cardsByCell} />
        <QualityBreakdown cards={cards} />
      </div>

      {/* Row 3: Recent Cards */}
      <RecentCardsFeed cards={cards} onCardClick={onCardClick} />
    </div>
  );
}
