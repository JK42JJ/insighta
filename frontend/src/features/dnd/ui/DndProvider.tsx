import { useState, useCallback, type ReactNode } from 'react';
import {
  DndContext,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
  type Active,
  closestCenter,
  pointerWithin,
  rectIntersection,
  type CollisionDetection,
} from '@dnd-kit/core';
import { useDndSensors } from '../model/useDndSetup';
import { DndDragOverlayComponent } from './DragOverlay';
import { isCardDrag, isMultiCardDrag, isCellDrag, type DragData } from '../model/types';

interface DndProviderProps {
  children: ReactNode;
  onCardDropOnCell?: (cardId: string, cellIndex: number) => void;
  onMultiCardDropOnCell?: (cardIds: string[], cellIndex: number) => void;
  onCellSwap?: (fromIndex: number, toIndex: number) => void;
  onCardDropOnScratchPad?: (cardId: string) => void;
  onMultiCardDropOnScratchPad?: (cardIds: string[]) => void;
  onCardReorder?: (activeId: string, overId: string) => void;
  onDragStart?: (data: DragData) => void;
  onDragEnd?: () => void;
  onDragOverCell?: (cellIndex: number | null) => void;
}

const collisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  if (pointerCollisions.length > 0) return pointerCollisions;
  return rectIntersection(args);
};

export function DndProvider({
  children,
  onCardDropOnCell,
  onMultiCardDropOnCell,
  onCellSwap,
  onCardDropOnScratchPad,
  onMultiCardDropOnScratchPad,
  onCardReorder,
  onDragStart,
  onDragEnd,
  onDragOverCell,
}: DndProviderProps) {
  const sensors = useDndSensors();
  const [activeItem, setActiveItem] = useState<Active | null>(null);

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      setActiveItem(event.active);
      const data = event.active.data.current as DragData | undefined;
      if (data) {
        onDragStart?.(data);
      }
    },
    [onDragStart]
  );

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const overData = event.over?.data.current as
        | { type?: string; cellIndex?: number }
        | undefined;
      if (overData?.type === 'cell') {
        onDragOverCell?.(overData.cellIndex ?? null);
      } else {
        onDragOverCell?.(null);
      }
    },
    [onDragOverCell]
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveItem(null);
      onDragOverCell?.(null);
      onDragEnd?.();

      const { active, over } = event;
      if (!over) return;

      const activeData = active.data.current as DragData | undefined;
      const overData = over.data.current as
        | {
            type?: string;
            cellIndex?: number;
            accepts?: string[];
          }
        | undefined;

      if (!activeData || !overData) return;

      // Cell → Cell swap
      if (isCellDrag(activeData) && overData.type === 'cell') {
        const fromIndex = activeData.cellIndex;
        const toIndex = overData.cellIndex;
        if (fromIndex !== undefined && toIndex !== undefined && fromIndex !== toIndex) {
          onCellSwap?.(fromIndex, toIndex);
        }
        return;
      }

      // Card/MultiCard → Cell
      if ((isCardDrag(activeData) || isMultiCardDrag(activeData)) && overData.type === 'cell') {
        const cellIndex = overData.cellIndex;
        if (cellIndex === undefined) return;

        if (isMultiCardDrag(activeData)) {
          const cardIds = activeData.cards.map((c) => c.id);
          onMultiCardDropOnCell?.(cardIds, cellIndex);
        } else {
          onCardDropOnCell?.(activeData.card.id, cellIndex);
        }
        return;
      }

      // Card/MultiCard → ScratchPad
      if (
        (isCardDrag(activeData) || isMultiCardDrag(activeData)) &&
        overData.type === 'scratchpad'
      ) {
        if (isMultiCardDrag(activeData)) {
          const cardIds = activeData.cards.map((c) => c.id);
          onMultiCardDropOnScratchPad?.(cardIds);
        } else {
          onCardDropOnScratchPad?.(activeData.card.id);
        }
        return;
      }

      // Card → Card (reorder within CardList)
      if (isCardDrag(activeData) && overData.type === 'card-reorder') {
        if (active.id !== over.id) {
          onCardReorder?.(String(active.id), String(over.id));
        }
        return;
      }
    },
    [
      onCardDropOnCell,
      onMultiCardDropOnCell,
      onCellSwap,
      onCardDropOnScratchPad,
      onMultiCardDropOnScratchPad,
      onCardReorder,
      onDragEnd,
      onDragOverCell,
    ]
  );

  const handleDragCancel = useCallback(() => {
    setActiveItem(null);
    onDragOverCell?.(null);
    onDragEnd?.();
  }, [onDragEnd, onDragOverCell]);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      {children}
      <DndDragOverlayComponent active={activeItem} />
    </DndContext>
  );
}
