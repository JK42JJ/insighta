import type { InsightCard } from '@/types/mandala';

export type DragType = 'card' | 'multi-card' | 'cell';

export interface CardDragData {
  type: 'card';
  card: InsightCard;
}

export interface MultiCardDragData {
  type: 'multi-card';
  cards: InsightCard[];
  primaryCardId: string;
}

export interface CellDragData {
  type: 'cell';
  cellIndex: number;
}

export type DragData = CardDragData | MultiCardDragData | CellDragData;

export function isCardDrag(data: DragData | undefined): data is CardDragData {
  return data?.type === 'card';
}

export function isMultiCardDrag(data: DragData | undefined): data is MultiCardDragData {
  return data?.type === 'multi-card';
}

export function isCellDrag(data: DragData | undefined): data is CellDragData {
  return data?.type === 'cell';
}
