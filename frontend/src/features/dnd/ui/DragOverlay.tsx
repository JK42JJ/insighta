import { DragOverlay as DndDragOverlay } from '@dnd-kit/core';
import type { Active } from '@dnd-kit/core';
import { isCardDrag, isMultiCardDrag, isCellDrag, type DragData } from '../model/types';
import { cn } from '@/lib/utils';

interface DndDragOverlayProps {
  active: Active | null;
}

function CardOverlayContent({ thumbnail, title }: { thumbnail: string; title: string }) {
  return (
    <div
      className="w-[100px] h-[64px] rounded-lg overflow-hidden border-2 border-white/15 shadow-xl"
      style={{
        background: 'linear-gradient(135deg, #2a2a2a 0%, #1a1a1a 100%)',
        transform: 'rotate(-2deg)',
      }}
    >
      <img src={thumbnail} alt={title} className="w-full h-full object-cover brightness-95" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
    </div>
  );
}

function MultiCardOverlayContent({ cards }: { cards: { thumbnail: string; title: string }[] }) {
  const maxThumbs = Math.min(cards.length, 3);
  return (
    <div className="relative w-[100px] h-[70px]" style={{ perspective: '400px' }}>
      {Array.from({ length: maxThumbs })
        .map((_, i) => maxThumbs - 1 - i)
        .map((i) => {
          const offset = i * 6;
          const rotation = (i - 1) * -3;
          const scale = 1 - i * 0.02;
          return (
            <div
              key={i}
              className="absolute rounded-lg overflow-hidden border-2 border-white/15"
              style={{
                left: offset,
                top: offset,
                width: 88,
                height: 56,
                transform: `rotate(${rotation}deg) scale(${scale})`,
                background: 'linear-gradient(135deg, #2a2a2a 0%, #1a1a1a 100%)',
                boxShadow: `0 ${4 + i * 2}px ${12 + i * 4}px rgba(0,0,0,${0.3 - i * 0.05})`,
                zIndex: maxThumbs - i,
              }}
            >
              {cards[i] && (
                <img
                  src={cards[i].thumbnail}
                  alt={cards[i].title}
                  className="w-full h-full object-cover brightness-95"
                />
              )}
            </div>
          );
        })}
      <div
        className="absolute -right-1 -top-2 min-w-[28px] h-[28px] rounded-full flex items-center justify-center text-[13px] font-bold text-white px-2 z-50"
        style={{
          background: 'linear-gradient(135deg, #FF6B3D 0%, #FF8F6B 100%)',
          boxShadow: '0 4px 12px rgba(255,107,61,0.4)',
          border: '2px solid rgba(255,255,255,0.2)',
        }}
      >
        {cards.length}
      </div>
    </div>
  );
}

function CellOverlayContent({ cellIndex }: { cellIndex: number }) {
  return (
    <div className="w-[80px] h-[80px] rounded-xl bg-primary/20 border-2 border-primary/50 flex items-center justify-center shadow-lg backdrop-blur-sm">
      <span className="text-primary font-bold text-lg">↔</span>
    </div>
  );
}

export function DndDragOverlayComponent({ active }: DndDragOverlayProps) {
  if (!active) return null;

  const data = active.data.current as DragData | undefined;

  return (
    <DndDragOverlay dropAnimation={null} style={{ cursor: 'grabbing' }}>
      {isCardDrag(data) && (
        <CardOverlayContent thumbnail={data.card.thumbnail} title={data.card.title} />
      )}
      {isMultiCardDrag(data) && <MultiCardOverlayContent cards={data.cards} />}
      {isCellDrag(data) && <CellOverlayContent cellIndex={data.cellIndex} />}
    </DndDragOverlay>
  );
}
