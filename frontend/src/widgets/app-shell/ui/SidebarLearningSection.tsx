import { useState } from 'react';
import { ChevronRight, BookOpen, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useMandalaQuery } from '@/features/mandala';
import { useMandalaCards } from '@/pages/learning/model/useMandalaCards';
import type { InsightCard } from '@/entities/card/model/types';
import { cn } from '@/shared/lib/utils';

interface SidebarLearningSectionProps {
  mandalaId: string;
  currentVideoId?: string;
  collapsed: boolean;
}

export function SidebarLearningSection({ mandalaId, collapsed }: SidebarLearningSectionProps) {
  const { t } = useTranslation();
  const [selectedCell, setSelectedCell] = useState<number | null>(null);

  const { mandalaLevels } = useMandalaQuery(mandalaId);
  const rootLevel = mandalaLevels.root;
  const centerGoal = rootLevel?.centerGoal ?? '';
  const subGoals = rootLevel?.subjects ?? [];

  const { cards: mandalaCards } = useMandalaCards(mandalaId);

  const cardsByCell = new Map<number, InsightCard[]>();
  for (const card of mandalaCards) {
    const list = cardsByCell.get(card.cellIndex) ?? [];
    list.push(card);
    cardsByCell.set(card.cellIndex, list);
  }

  if (collapsed) {
    return (
      <div className="px-2 py-1">
        <button
          className="w-full flex items-center justify-center px-2 py-2.5 rounded-lg text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
          title={centerGoal || t('sidebar.learning', 'Learning')}
        >
          <BookOpen className="w-5 h-5" />
        </button>
      </div>
    );
  }

  return (
    <div className="px-2 flex flex-col">
      <div className="px-3 py-2">
        <h3 className="text-[13px] font-bold text-sidebar-foreground leading-snug truncate">
          {centerGoal || t('sidebar.learning', 'Learning')}
        </h3>
        <p className="mt-0.5 text-[11px] text-sidebar-foreground/50">
          {mandalaCards.length}
          {t('learning.videoCount', '개 영상')}
        </p>
      </div>

      <div className="my-1 mx-2">
        <div className="h-px bg-sidebar-border" />
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-none">
        {subGoals.map((goal, idx) => {
          const cellCards = cardsByCell.get(idx + 1) ?? [];
          const isExpanded = selectedCell === idx + 1;

          return (
            <div key={idx}>
              <button
                onClick={() => setSelectedCell(isExpanded ? null : idx + 1)}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-2 text-left rounded-lg transition-colors',
                  isExpanded
                    ? 'bg-sidebar-accent text-sidebar-foreground'
                    : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50'
                )}
              >
                <ChevronRight
                  className={cn('h-3 w-3 shrink-0 transition-transform', isExpanded && 'rotate-90')}
                />
                <span className="flex-1 truncate text-[12px] font-medium">{goal}</span>
                {cellCards.length > 0 && (
                  <span className="shrink-0 rounded-full bg-sidebar-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-sidebar-primary">
                    {cellCards.length}
                  </span>
                )}
              </button>

              {isExpanded && (
                <div className="px-3 pl-8 py-2">
                  <div className="flex items-center gap-1.5 text-[11px] text-sidebar-foreground/40">
                    <Sparkles className="w-3 h-3 shrink-0" />
                    <span>
                      {cellCards.length > 0
                        ? t('learning.reportPreparing', '보고서 작성 준비중 ...')
                        : t('learning.contentCollecting', '콘텐츠 수집 중...')}
                    </span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
