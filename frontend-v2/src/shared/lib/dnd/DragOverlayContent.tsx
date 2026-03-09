import type { DragData } from './types';
import { GripVertical } from 'lucide-react';

interface DragOverlayContentProps {
  dragData: DragData | null;
  allCards?: Map<string, { thumbnail: string; title: string }>;
  cellLabels?: Map<number, string>;
}

export function DragOverlayContent({ dragData, allCards, cellLabels }: DragOverlayContentProps) {
  if (!dragData) return null;

  if (dragData.type === 'card' || dragData.type === 'card-reorder') {
    const selectedCount = dragData.type === 'card' ? (dragData.selectedCardIds?.length ?? 1) : 1;
    const card = dragData.card;

    if (selectedCount > 1 && dragData.type === 'card') {
      const ids = dragData.selectedCardIds!;
      const maxThumbs = Math.min(ids.length, 3);
      return (
        <div className="relative w-[100px] h-[70px]" style={{ transformStyle: 'preserve-3d' }}>
          {Array.from({ length: maxThumbs }).map((_, i) => {
            const id = ids[i];
            const info = allCards?.get(id);
            return (
              <div
                key={id}
                className="absolute rounded-lg overflow-hidden border-2 border-white/15 shadow-lg"
                style={{
                  width: 88,
                  height: 56,
                  left: i * 6,
                  top: i * 6,
                  transform: `rotate(${(i - 1) * -3}deg) scale(${1 - i * 0.02})`,
                  zIndex: maxThumbs - i,
                }}
              >
                {info?.thumbnail && (
                  <img src={info.thumbnail} alt="" className="w-full h-full object-cover brightness-95" />
                )}
              </div>
            );
          })}
          <div
            className="absolute -top-2 -right-1 min-w-[28px] h-7 px-2 rounded-full flex items-center justify-center text-[13px] font-bold text-white z-50"
            style={{
              background: 'hsl(var(--primary))',
              boxShadow: '0 4px 12px hsl(var(--primary) / 0.4)',
            }}
          >
            {ids.length}
          </div>
        </div>
      );
    }

    return (
      <div
        className="w-[100px] h-[64px] rounded-lg overflow-hidden border-2 border-white/15 shadow-xl -rotate-2"
        style={{ background: 'hsl(var(--bg-light))' }}
      >
        {card.thumbnail && (
          <img src={card.thumbnail} alt={card.title} className="w-full h-full object-cover brightness-95" />
        )}
      </div>
    );
  }

  if (dragData.type === 'cell') {
    const label = cellLabels?.get(dragData.gridIndex) ?? `Cell ${dragData.gridIndex}`;
    return (
      <div
        className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl border shadow-2xl whitespace-nowrap"
        style={{
          background: 'linear-gradient(135deg, hsl(var(--card)) 0%, hsl(var(--card)/0.95) 100%)',
          borderColor: 'hsl(var(--primary) / 0.4)',
          boxShadow: '0 8px 32px -4px hsl(var(--primary) / 0.2), 0 4px 12px -2px rgba(0,0,0,0.3)',
          backdropFilter: 'blur(12px)',
        }}
      >
        <GripVertical className="w-4 h-4 text-primary shrink-0" />
        <span className="text-sm font-semibold text-primary">{label}</span>
      </div>
    );
  }

  return null;
}
