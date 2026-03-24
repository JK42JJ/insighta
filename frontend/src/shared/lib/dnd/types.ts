import type { InsightCard } from '@/entities/card/model/types';

// Data attached to draggable items
export type DragData =
  | { type: 'card'; card: InsightCard; selectedCardIds?: string[] }
  | { type: 'cell'; gridIndex: number }
  | { type: 'card-reorder'; card: InsightCard };

// Data attached to droppable zones
export type DropData =
  | { type: 'mandala-cell'; gridIndex: number; subjectIndex: number }
  | { type: 'card-slot'; cardId: string; cardIndex: number }
  | { type: 'scratchpad' }
  | { type: 'grid-area' };

// Unique ID helpers
export function cardDragId(cardId: string) {
  return `drag-card-${cardId}`;
}

export function cellDragId(gridIndex: number) {
  return `drag-cell-${gridIndex}`;
}

export function cellDropId(gridIndex: number) {
  return `drop-cell-${gridIndex}`;
}

export function cardSlotDropId(cardId: string) {
  return `drop-slot-${cardId}`;
}
