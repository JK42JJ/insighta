import { useDraggable } from '@dnd-kit/core';
import { InsightCard } from '@/entities/card/model/types';
import { type DragData, cardDragId } from '@/shared/lib/dnd';
import { extractUrlFromDragData, extractUrlFromHtml } from '@/shared/data/mockData';
import { Lightbulb, Plus, ExternalLink } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import {
  handleThumbnailError,
  handleThumbnailLoad,
  upgradeYouTubeThumbnail,
} from '@/shared/lib/image-utils';
import {
  format,
  differenceInHours,
  differenceInDays,
  differenceInWeeks,
  differenceInMonths,
} from 'date-fns';
import { useTranslation } from 'react-i18next';

interface ScratchPadProps {
  cards: InsightCard[];
  isDropTarget: boolean;
  onDrop: (url: string) => void;
  onCardDrop: (cardId: string) => void;
  onCardClick: (card: InsightCard) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
}

// Dynamic time label based on age
function getTimeLabel(
  date: Date,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  const now = new Date();
  const hours = differenceInHours(now, date);
  const days = differenceInDays(now, date);
  const weeks = differenceInWeeks(now, date);
  const months = differenceInMonths(now, date);

  if (hours < 1) {
    return t('time.justNow');
  } else if (hours < 24) {
    return t('time.hoursAgo', { count: hours });
  } else if (days < 7) {
    return t('time.daysAgo', { count: days });
  } else if (weeks < 4) {
    return t('time.weeksAgo', { count: weeks });
  } else if (months < 12) {
    return t('time.monthsAgo', { count: months });
  } else {
    return format(date, 'yy.MM');
  }
}

function DraggableScratchCard({
  card,
  children,
}: {
  card: InsightCard;
  children: (props: {
    isDragging: boolean;
    dragRef: (node: HTMLElement | null) => void;
    dragListeners: ReturnType<typeof useDraggable>['listeners'];
    dragAttributes: ReturnType<typeof useDraggable>['attributes'];
  }) => React.ReactNode;
}) {
  const dragData: DragData = { type: 'card', card };
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: cardDragId(card.id),
    data: dragData,
  });

  return (
    <>
      {children({
        isDragging,
        dragRef: setNodeRef,
        dragListeners: listeners,
        dragAttributes: attributes,
      })}
    </>
  );
}

// Get tick style based on time resolution
function getTickStyle(date: Date): { height: string; opacity: string } {
  const now = new Date();
  const hours = differenceInHours(now, date);

  if (hours < 24) {
    return { height: 'h-3', opacity: 'bg-primary' };
  } else if (hours < 168) {
    return { height: 'h-2.5', opacity: 'bg-primary/80' };
  } else if (hours < 720) {
    return { height: 'h-2', opacity: 'bg-primary/60' };
  } else {
    return { height: 'h-1.5', opacity: 'bg-primary/40' };
  }
}

export function ScratchPad({
  cards,
  isDropTarget,
  onDrop,
  onCardDrop,
  onCardClick,
  onDragOver,
  onDragLeave,
}: ScratchPadProps) {
  const { t } = useTranslation();

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    onDragOver(e);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();

    const cardId = e.dataTransfer.getData('application/card-id');
    if (cardId) {
      onCardDrop(cardId);
      return;
    }

    const rawUrl = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
    let url = rawUrl ? extractUrlFromDragData(rawUrl) : null;
    // Fallback: text/html에서 href 추출
    if (!url) {
      const html = e.dataTransfer.getData('text/html');
      if (html) url = extractUrlFromHtml(html);
    }
    if (url) {
      onDrop(url);
    }
  };

  const sortedCards = [...cards].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  return (
    <div
      className={cn(
        'relative px-4 py-3 rounded-xl transition-all duration-300',
        'bg-surface-light border border-border/40',
        isDropTarget
          ? 'border-2 border-dashed border-primary bg-primary/5 scale-[1.01]'
          : 'hover:border-border/60'
      )}
      style={{ boxShadow: isDropTarget ? 'var(--shadow-lg)' : 'var(--shadow-sm)' }}
      onDragOver={handleDragOver}
      onDragLeave={onDragLeave}
      onDrop={handleDrop}
    >
      {/* Drop target overlay */}
      {isDropTarget && (
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
        {/* Label */}
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

        {/* Timeline with Ruler */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Timeline Ruler with dynamic time labels */}
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

          {/* Timeline Cards */}
          {cards.length === 0 ? (
            <div
              className={cn(
                'flex items-center gap-2 text-muted-foreground py-1',
                isDropTarget && 'text-primary'
              )}
            >
              <Plus className="w-4 h-4 opacity-50" />
              <p className="text-xs">{t('ideation.emptyHint')}</p>
            </div>
          ) : (
            <div className="flex gap-2 overflow-x-auto scrollbar-none py-1">
              {sortedCards.map((card) => (
                <DraggableScratchCard key={card.id} card={card}>
                  {({ isDragging, dragRef, dragListeners, dragAttributes }) => (
                    <div
                      ref={dragRef}
                      {...dragAttributes}
                      onClick={() => onCardClick(card)}
                      className={cn(
                        'group relative flex-shrink-0 cursor-grab active:cursor-grabbing transition-transform duration-200 hover:-translate-y-0.5',
                        isDragging && 'opacity-30'
                      )}
                    >
                      {/* Drag handle */}
                      <div {...dragListeners} className="absolute inset-0 z-[1]" />
                      <div
                        className="relative w-[80px] h-[45px] overflow-hidden bg-muted"
                        style={{ boxShadow: 'var(--shadow-sm)' }}
                      >
                        <img
                          src={upgradeYouTubeThumbnail(card.thumbnail) ?? card.thumbnail}
                          alt={card.title}
                          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110"
                          onError={handleThumbnailError}
                          onLoad={handleThumbnailLoad}
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
                  )}
                </DraggableScratchCard>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
