import { useCallback } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { InsightCard } from '@/types/mandala';
import { Lightbulb, Plus, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  format,
  differenceInHours,
  differenceInDays,
  differenceInWeeks,
  differenceInMonths,
} from 'date-fns';
import { useTranslation } from 'react-i18next';
import { createCardDragData } from '@/features/dnd';

interface ScratchPadProps {
  cards: InsightCard[];
  isDropTarget: boolean;
  onDrop: (url: string) => void;
  onCardClick: (card: InsightCard) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
}

function getTimeLabel(
  date: Date,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  const now = new Date();
  const hours = differenceInHours(now, date);
  const days = differenceInDays(now, date);
  const weeks = differenceInWeeks(now, date);
  const months = differenceInMonths(now, date);

  if (hours < 1) return t('time.justNow');
  if (hours < 24) return t('time.hoursAgo', { count: hours });
  if (days < 7) return t('time.daysAgo', { count: days });
  if (weeks < 4) return t('time.weeksAgo', { count: weeks });
  if (months < 12) return t('time.monthsAgo', { count: months });
  return format(date, 'yy.MM');
}

function getTickStyle(date: Date): { height: string; opacity: string } {
  const now = new Date();
  const hours = differenceInHours(now, date);

  if (hours < 24) return { height: 'h-3', opacity: 'bg-primary' };
  if (hours < 168) return { height: 'h-2.5', opacity: 'bg-primary/80' };
  if (hours < 720) return { height: 'h-2', opacity: 'bg-primary/60' };
  return { height: 'h-1.5', opacity: 'bg-primary/40' };
}

export function ScratchPad({
  cards,
  isDropTarget,
  onDrop,
  onCardClick,
  onDragOver,
  onDragLeave,
}: ScratchPadProps) {
  const { t } = useTranslation();

  // dnd-kit droppable
  const { setNodeRef, isOver } = useDroppable({
    id: 'scratchpad-docked',
    data: { type: 'scratchpad' },
  });

  // HTML5 handlers for external URL drops only
  const handleExternalDragOver = useCallback(
    (e: React.DragEvent) => {
      const types = e.dataTransfer.types;
      const isExternal =
        types.includes('text/uri-list') ||
        (types.includes('text/plain') && !types.includes('application/card-id'));
      if (isExternal) {
        e.preventDefault();
        onDragOver(e);
      }
    },
    [onDragOver]
  );

  const handleExternalDrop = useCallback(
    (e: React.DragEvent) => {
      const types = e.dataTransfer.types;
      const hasInternalData =
        types.includes('application/card-id') || types.includes('application/multi-card-ids');
      if (hasInternalData) return;

      e.preventDefault();
      const url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
      if (url && url.includes('youtube')) {
        onDrop(url);
      }
    },
    [onDrop]
  );

  const sortedCards = [...cards].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  const showDropTarget = isDropTarget || isOver;

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'relative px-4 py-3 rounded-xl transition-all duration-300',
        'bg-surface-light border border-border/40',
        showDropTarget ? 'border-primary bg-primary/8 scale-[1.01]' : 'hover:border-border/60'
      )}
      style={{ boxShadow: showDropTarget ? 'var(--shadow-lg)' : 'var(--shadow-sm)' }}
      onDragOver={handleExternalDragOver}
      onDragLeave={onDragLeave}
      onDrop={handleExternalDrop}
    >
      {showDropTarget && (
        <div className="absolute inset-0 flex items-center justify-center bg-primary/15 backdrop-blur-[2px] rounded-xl pointer-events-none z-10">
          <span
            className="text-primary-foreground font-semibold text-sm bg-primary px-4 py-2 rounded-lg"
            style={{ boxShadow: 'var(--shadow-lg)' }}
          >
            {t('ideation.dropOnScratchPad')}
          </span>
        </div>
      )}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 flex-shrink-0">
          <div
            className="p-1.5 rounded-lg bg-primary/10"
            style={{ boxShadow: 'var(--shadow-inset-raised)' }}
          >
            <Lightbulb className="w-4 h-4 text-primary" />
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-semibold text-foreground">{t('ideation.title')}</span>
            {cards.length > 0 && (
              <span className="text-[10px] text-primary font-medium">
                {t('common.items', { count: cards.length })}
              </span>
            )}
          </div>
        </div>

        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex items-end h-4 border-b border-border/30 mb-1.5">
            <div className="flex-1 flex items-end overflow-x-auto scrollbar-none">
              {cards.length === 0 ? (
                <div className="flex items-center gap-1 px-2">
                  {Array.from({ length: 20 }).map((_, i) => (
                    <div
                      key={i}
                      className="flex flex-col items-center"
                      style={{ minWidth: '40px' }}
                    >
                      <div className={cn('w-px bg-border/50', i % 5 === 0 ? 'h-2' : 'h-1')} />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-end">
                  {sortedCards.map((card, idx) => {
                    const tickStyle = getTickStyle(new Date(card.createdAt));
                    const timeLabel = getTimeLabel(new Date(card.createdAt), t);
                    const showLabel = idx === 0 || idx === sortedCards.length - 1 || idx % 3 === 0;

                    return (
                      <div
                        key={card.id}
                        className="flex-shrink-0 flex flex-col items-start"
                        style={{ width: '88px' }}
                      >
                        <span
                          className={cn(
                            'text-[8px] text-muted-foreground mb-0.5 pl-0.5 font-medium',
                            showLabel ? 'opacity-100' : 'opacity-0'
                          )}
                        >
                          {timeLabel}
                        </span>
                        <div className="flex items-end w-full">
                          <div className={cn('w-px', tickStyle.height, tickStyle.opacity)} />
                          <div className="flex-1 flex justify-evenly">
                            {[1, 2, 3].map((tick) => (
                              <div key={tick} className="w-px h-1 bg-border/40" />
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <div className="w-px h-3 bg-primary flex-shrink-0" />
                </div>
              )}
            </div>
          </div>

          {cards.length === 0 ? (
            <div
              className={cn(
                'flex items-center gap-2 text-muted-foreground py-1',
                showDropTarget && 'text-primary'
              )}
            >
              <Plus className="w-4 h-4 opacity-50" />
              <p className="text-xs">{t('ideation.emptyHint')}</p>
            </div>
          ) : (
            <div className="flex gap-2 overflow-x-auto scrollbar-none py-1">
              {sortedCards.map((card) => (
                <ScratchPadCardItem key={card.id} card={card} onCardClick={onCardClick} t={t} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ScratchPadCardItem({
  card,
  onCardClick,
  t,
}: {
  card: InsightCard;
  onCardClick: (card: InsightCard) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `sp-card-${card.id}`,
    data: createCardDragData(card),
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={() => onCardClick(card)}
      className={cn(
        'group relative flex-shrink-0 cursor-grab active:cursor-grabbing transition-transform duration-200 hover:-translate-y-0.5',
        isDragging && 'opacity-50'
      )}
    >
      <div
        className="relative w-[80px] h-[45px] overflow-hidden bg-muted"
        style={{ boxShadow: 'var(--shadow-sm)' }}
      >
        <img
          src={card.thumbnail}
          alt={card.title}
          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110"
          onError={(e) => {
            (e.target as HTMLImageElement).src =
              'https://via.placeholder.com/320x180?text=Thumbnail';
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-foreground/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
        <span className="absolute bottom-0.5 right-0.5 text-[8px] bg-background/90 text-foreground px-1 font-medium rounded-sm">
          {getTimeLabel(new Date(card.createdAt), t)}
        </span>
        <a
          href={card.videoUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="absolute top-0.5 right-0.5 z-10 bg-background/90 p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity text-primary"
        >
          <ExternalLink className="w-2.5 h-2.5" />
        </a>
      </div>
    </div>
  );
}
