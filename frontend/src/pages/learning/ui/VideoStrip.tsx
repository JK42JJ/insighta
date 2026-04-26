import { useRef, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useMandalaCards } from '../model/useMandalaCards';
import { cn } from '@/shared/lib/utils';

interface VideoStripProps {
  mandalaId: string;
  currentVideoId: string;
}

const SCROLL_AMOUNT = 200;

export function VideoStrip({ mandalaId, currentVideoId }: VideoStripProps) {
  const navigate = useNavigate();
  const scrollRef = useRef<HTMLDivElement>(null);
  const { cards } = useMandalaCards(mandalaId);

  const mandalaCards = cards
    .map((c) => {
      const match = c.videoUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/);
      return { ...c, ytId: match?.[1] ?? null };
    })
    .filter((c) => c.ytId);

  const scroll = useCallback((direction: 'left' | 'right') => {
    scrollRef.current?.scrollBy({
      left: direction === 'left' ? -SCROLL_AMOUNT : SCROLL_AMOUNT,
      behavior: 'smooth',
    });
  }, []);

  useEffect(() => {
    if (!scrollRef.current) return;
    const activeEl = scrollRef.current.querySelector('[data-active="true"]');
    if (activeEl) {
      activeEl.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    }
  }, [currentVideoId]);

  if (mandalaCards.length <= 1) return null;

  return (
    <div className="relative shrink-0 border-b border-border bg-card/50">
      <button
        onClick={() => scroll('left')}
        className="absolute left-0 top-0 bottom-0 z-10 flex w-8 items-center justify-center bg-gradient-to-r from-background/90 to-transparent text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </button>

      <div
        ref={scrollRef}
        className="group/strip flex items-end gap-2 overflow-x-auto scrollbar-none px-10 py-2"
      >
        {mandalaCards.map((card) => {
          const isActive = card.ytId === currentVideoId;
          return (
            <div
              key={card.id}
              data-active={isActive}
              onClick={() => {
                if (!isActive) navigate(`/learning/${mandalaId}/${card.ytId}`);
              }}
              title={card.title}
              className={cn(
                'group relative flex-shrink-0 cursor-pointer transition-transform duration-200 hover:-translate-y-1',
                isActive
                  ? 'group-hover/strip:ring-2 group-hover/strip:ring-primary group-hover/strip:ring-offset-1 group-hover/strip:ring-offset-background rounded'
                  : 'grayscale hover:grayscale-0'
              )}
            >
              <div
                className="relative w-14 h-8 overflow-hidden rounded bg-muted"
                style={{ boxShadow: 'var(--shadow-sm)' }}
              >
                {card.thumbnail ? (
                  <img
                    src={card.thumbnail}
                    alt=""
                    className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110"
                  />
                ) : (
                  <div className="w-full h-full bg-muted" />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-foreground/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </div>
          );
        })}
      </div>

      <button
        onClick={() => scroll('right')}
        className="absolute right-0 top-0 bottom-0 z-10 flex w-8 items-center justify-center bg-gradient-to-l from-background/90 to-transparent text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
