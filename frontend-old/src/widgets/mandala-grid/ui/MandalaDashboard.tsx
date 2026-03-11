import { useState } from 'react';
import { cn } from '@/shared/lib/utils';
import { InsightCard } from '@/entities/card/model/types';
import { RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface MandalaDashboardProps {
  centerGoal: string;
  subjects: string[];
  cardsByCell: Record<number, InsightCard[]>;
  onFlipBack: () => void;
}

export function MandalaDashboard({
  centerGoal,
  subjects,
  cardsByCell,
  onFlipBack,
}: MandalaDashboardProps) {
  const { t } = useTranslation();
  const [currentPage, setCurrentPage] = useState(0);

  const totalCards = Object.values(cardsByCell).reduce((sum, cards) => sum + cards.length, 0);

  // Calculate card counts per category for heatmap
  const categoryCounts = subjects.map((subject, index) => ({
    subject,
    count: cardsByCell[index]?.length || 0,
  }));

  const maxCount = Math.max(...categoryCounts.map((c) => c.count), 1);

  // Mock monthly data (in real app, this would come from card timestamps)
  const monthlyData = [
    { month: 'Jan', count: 40 },
    { month: 'Feb', count: 42 },
    { month: 'Mar', count: 50 },
    { month: 'Apr', count: 75 },
    { month: 'May', count: 85 },
    { month: 'Jun', count: 90 },
  ];

  const maxMonthlyCount = Math.max(...monthlyData.map((m) => m.count));

  // Quality distribution (mock data based on memo presence)
  const cardsWithMemo = Object.values(cardsByCell)
    .flat()
    .filter((c) => c.userNote && c.userNote.trim().length > 0).length;
  const cardsWithoutMemo = totalCards - cardsWithMemo;

  const pages = [
    {
      title: t('dashboard.focusMap'),
      subtitle: t('dashboard.focusMapSubtitle'),
      description: t('dashboard.focusMapDesc'),
    },
    {
      title: t('dashboard.monthlyTrend'),
      subtitle: t('dashboard.monthlyTrendSubtitle'),
      description: t('dashboard.monthlyTrendDesc'),
    },
    {
      title: t('dashboard.qualityAnalysis'),
      subtitle: t('dashboard.qualityAnalysisSubtitle'),
      description: t('dashboard.qualityAnalysisDesc'),
    },
  ];

  return (
    <div className="w-full h-full flex flex-col">
      {/* Page indicator dots */}
      <div className="flex justify-center gap-2 mb-4">
        {pages.map((_, index) => (
          <button
            key={index}
            onClick={() => setCurrentPage(index)}
            className={cn(
              'w-2 h-2 rounded-full transition-all duration-300',
              currentPage === index
                ? 'bg-primary w-6'
                : 'bg-muted-foreground/30 hover:bg-muted-foreground/50'
            )}
          />
        ))}
      </div>

      {/* Page content */}
      <div className="flex-1 overflow-hidden relative">
        {/* Page 1: Focus Map (Heatmap) */}
        <div
          className={cn(
            'absolute inset-0 transition-all duration-300',
            currentPage === 0
              ? 'opacity-100 translate-x-0'
              : 'opacity-0 -translate-x-full pointer-events-none'
          )}
        >
          <div className="h-full flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-foreground">{pages[0].title}</h3>
              <span className="text-[10px] text-muted-foreground">
                R2 6개월 B2. 64 insights/web
              </span>
            </div>

            {/* Heatmap Grid */}
            <div className="flex-1 flex gap-3">
              <div className="flex-1 grid grid-cols-4 gap-1 auto-rows-fr">
                {categoryCounts.map((cat, idx) => {
                  const intensity = cat.count / maxCount;
                  return (
                    <div
                      key={idx}
                      className="rounded-sm flex items-center justify-center text-[10px] font-medium transition-colors"
                      style={{
                        backgroundColor: `hsl(var(--primary) / ${0.1 + intensity * 0.7})`,
                        color:
                          intensity > 0.5
                            ? 'hsl(var(--primary-foreground))'
                            : 'hsl(var(--foreground))',
                      }}
                    >
                      {cat.count}
                    </div>
                  );
                })}
              </div>

              {/* Legend */}
              <div className="w-24 flex flex-col gap-1 text-[8px] text-muted-foreground">
                {categoryCounts.slice(0, 6).map((cat, idx) => (
                  <div key={idx} className="flex items-center gap-1">
                    <div
                      className="w-2 h-2 rounded-sm"
                      style={{ backgroundColor: `hsl(var(--primary) / ${0.3 + idx * 0.1})` }}
                    />
                    <span className="truncate">{cat.subject}</span>
                  </div>
                ))}
              </div>
            </div>

            <p className="text-[10px] text-muted-foreground/60 mt-2">{pages[0].description}</p>
          </div>
        </div>

        {/* Page 2: Monthly Trend (Bar Chart) */}
        <div
          className={cn(
            'absolute inset-0 transition-all duration-300',
            currentPage === 1
              ? 'opacity-100 translate-x-0'
              : currentPage < 1
                ? 'opacity-0 translate-x-full pointer-events-none'
                : 'opacity-0 -translate-x-full pointer-events-none'
          )}
        >
          <div className="h-full flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-foreground">{pages[1].title}</h3>
              <span className="text-[10px] text-muted-foreground">
                R2 6개월 B2. 64 insights/month
              </span>
            </div>

            {/* Bar Chart */}
            <div className="flex-1 flex items-end gap-2 pb-6 relative">
              {/* Y-axis labels */}
              <div className="absolute left-0 top-0 bottom-6 flex flex-col justify-between text-[8px] text-muted-foreground w-6">
                <span>100</span>
                <span>80</span>
                <span>60</span>
                <span>40</span>
                <span>20</span>
                <span>0</span>
              </div>

              {/* Bars */}
              <div className="flex-1 flex items-end gap-2 pl-8">
                {monthlyData.map((data, idx) => (
                  <div key={idx} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-[9px] font-medium text-foreground">{data.count}</span>
                    <div
                      className="w-full rounded-t-sm bg-primary/70 transition-all duration-500"
                      style={{ height: `${(data.count / maxMonthlyCount) * 100}%` }}
                    />
                    <span className="text-[8px] text-muted-foreground">{data.month}</span>
                  </div>
                ))}
              </div>
            </div>

            <p className="text-[10px] text-muted-foreground/60">{pages[1].description}</p>
          </div>
        </div>

        {/* Page 3: Quality Analysis (Donut Chart) */}
        <div
          className={cn(
            'absolute inset-0 transition-all duration-300',
            currentPage === 2
              ? 'opacity-100 translate-x-0'
              : 'opacity-0 translate-x-full pointer-events-none'
          )}
        >
          <div className="h-full flex flex-col">
            <h3 className="text-sm font-semibold text-foreground mb-3">{pages[2].title}</h3>

            <div className="flex-1 flex gap-4">
              {/* Donut Chart */}
              <div className="flex-1 flex items-center justify-center">
                <div className="relative w-32 h-32">
                  <svg viewBox="0 0 100 100" className="transform -rotate-90">
                    {/* Background circle */}
                    <circle
                      cx="50"
                      cy="50"
                      r="40"
                      fill="none"
                      stroke="hsl(var(--muted))"
                      strokeWidth="16"
                    />
                    {/* Segments */}
                    {totalCards > 0 && (
                      <>
                        <circle
                          cx="50"
                          cy="50"
                          r="40"
                          fill="none"
                          stroke="hsl(var(--primary))"
                          strokeWidth="16"
                          strokeDasharray={`${(cardsWithMemo / totalCards) * 251.2} 251.2`}
                          strokeDashoffset="0"
                        />
                        <circle
                          cx="50"
                          cy="50"
                          r="40"
                          fill="none"
                          stroke="hsl(var(--primary) / 0.4)"
                          strokeWidth="16"
                          strokeDasharray={`${(cardsWithoutMemo / totalCards) * 251.2} 251.2`}
                          strokeDashoffset={`${-(cardsWithMemo / totalCards) * 251.2}`}
                        />
                      </>
                    )}
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-lg font-bold text-foreground">{totalCards}</span>
                    <span className="text-[8px] text-muted-foreground">
                      {t('dashboard.totalCards')}
                    </span>
                  </div>
                </div>
              </div>

              {/* Legend */}
              <div className="w-28 flex flex-col justify-center gap-2 text-[9px]">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-sm bg-primary" />
                  <div>
                    <div className="font-medium text-foreground">{t('dashboard.withMemo')}</div>
                    <div className="text-muted-foreground">
                      {t('common.items', { count: cardsWithMemo })} (
                      {totalCards > 0 ? Math.round((cardsWithMemo / totalCards) * 100) : 0}%)
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-sm bg-primary/40" />
                  <div>
                    <div className="font-medium text-foreground">{t('dashboard.withoutMemo')}</div>
                    <div className="text-muted-foreground">
                      {t('common.items', { count: cardsWithoutMemo })} (
                      {totalCards > 0 ? Math.round((cardsWithoutMemo / totalCards) * 100) : 0}%)
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <p className="text-[10px] text-muted-foreground/60 mt-2">{pages[2].description}</p>
          </div>
        </div>
      </div>

      {/* Flip back button */}
      <button
        onClick={onFlipBack}
        className={cn(
          'absolute bottom-3 right-3 p-2 rounded-full',
          'bg-primary/10 hover:bg-primary/20 text-primary',
          'transition-all duration-200 hover:scale-110'
        )}
      >
        <RotateCcw className="w-4 h-4" />
      </button>
    </div>
  );
}
