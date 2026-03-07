import type { InsightCard } from '@/types/mandala';
import type { CardDragData, MultiCardDragData, CellDragData } from '../model/types';

export function createCardDragData(card: InsightCard): CardDragData {
  return { type: 'card', card };
}

export function createMultiCardDragData(
  cards: InsightCard[],
  primaryCardId: string
): MultiCardDragData {
  return { type: 'multi-card', cards, primaryCardId };
}

export function createCellDragData(cellIndex: number): CellDragData {
  return { type: 'cell', cellIndex };
}
