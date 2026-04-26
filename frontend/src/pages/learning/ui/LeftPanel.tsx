import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useLocalCards } from '@/features/card-management/model';
import { useLearningStore } from '../model/useLearningStore';
import type { InsightCard } from '@/entities/card/model/types';

interface LeftPanelProps {
  mandalaId: string;
  centerGoal: string;
  subGoals: string[];
  currentVideoId?: string;
}

export function LeftPanel({ mandalaId, centerGoal, subGoals, currentVideoId }: LeftPanelProps) {
  const navigate = useNavigate();
  const selectedCell = useLearningStore((s) => s.selectedCellIndex);
  const setSelectedCell = useLearningStore((s) => s.setSelectedCell);
  const { cards } = useLocalCards();

  const mandalaCards = (cards ?? []).filter(
    (c: InsightCard) => c.mandalaId === mandalaId && c.cellIndex >= 0
  );

  const cardsByCell = new Map<number, InsightCard[]>();
  for (const card of mandalaCards) {
    const list = cardsByCell.get(card.cellIndex) ?? [];
    list.push(card);
    cardsByCell.set(card.cellIndex, list);
  }

  const handleVideoClick = (card: InsightCard) => {
    const youtubeMatch = card.videoUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/);
    const videoId = youtubeMatch?.[1];
    if (videoId) {
      navigate(`/learning/${mandalaId}/${videoId}`);
    }
  };

  return (
    <div className="flex flex-col border-r border-[hsl(var(--border))] bg-[hsl(var(--bg-base))]">
      {/* Header */}
      <div className="shrink-0 border-b border-[hsl(var(--border))] px-4 py-3">
        <h2 className="text-[13px] font-bold text-[hsl(var(--foreground))] leading-snug">
          {centerGoal || '학습 목표'}
        </h2>
        <p className="mt-0.5 text-[11px] text-[hsl(var(--muted-foreground))]">
          {mandalaCards.length}개 영상
        </p>
      </div>

      {/* Sub-goal tree */}
      <div className="flex-1 overflow-y-auto scrollbar-pro">
        <div className="py-2">
          {subGoals.map((goal, idx) => {
            const cellCards = cardsByCell.get(idx + 1) ?? [];
            const isSelected = selectedCell === idx + 1;

            return (
              <div key={idx}>
                <button
                  onClick={() => setSelectedCell(isSelected ? null : idx + 1)}
                  className={[
                    'flex w-full items-center gap-2 px-4 py-2.5 text-left transition-colors',
                    isSelected ? 'bg-[rgba(129,140,248,0.08)]' : 'hover:bg-[hsl(var(--bg-mid))]',
                  ].join(' ')}
                >
                  <ChevronRight
                    className={[
                      'h-3.5 w-3.5 shrink-0 text-[hsl(var(--muted-foreground))] transition-transform',
                      isSelected ? 'rotate-90' : '',
                    ].join(' ')}
                  />
                  <span className="flex-1 truncate text-[12px] font-medium text-[hsl(var(--foreground))]">
                    {goal}
                  </span>
                  {cellCards.length > 0 && (
                    <span className="shrink-0 rounded-full bg-[rgba(129,140,248,0.1)] px-1.5 py-0.5 text-[10px] font-semibold text-[#818cf8]">
                      {cellCards.length}
                    </span>
                  )}
                </button>

                {/* Expanded video list */}
                {isSelected && cellCards.length > 0 && (
                  <div className="pb-1">
                    {cellCards.map((card) => {
                      const youtubeMatch = card.videoUrl.match(
                        /(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/
                      );
                      const vidId = youtubeMatch?.[1];
                      const isActive = vidId === currentVideoId;

                      return (
                        <button
                          key={card.id}
                          onClick={() => handleVideoClick(card)}
                          className={[
                            'flex w-full items-center gap-2.5 px-4 pl-9 py-2 text-left transition-colors',
                            isActive
                              ? 'bg-[rgba(129,140,248,0.12)] text-[#818cf8]'
                              : 'hover:bg-[hsl(var(--bg-mid))] text-[hsl(var(--muted-foreground))]',
                          ].join(' ')}
                        >
                          {card.thumbnail ? (
                            <img
                              src={card.thumbnail}
                              alt=""
                              className="h-8 w-14 shrink-0 rounded object-cover"
                            />
                          ) : (
                            <div className="h-8 w-14 shrink-0 rounded bg-[hsl(var(--bg-mid))]" />
                          )}
                          <span className="flex-1 truncate text-[11px] leading-snug">
                            {card.title}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {isSelected && cellCards.length === 0 && (
                  <p className="px-4 pl-9 py-2 text-[11px] text-[hsl(var(--muted-foreground))]">
                    아직 영상이 없습니다
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
