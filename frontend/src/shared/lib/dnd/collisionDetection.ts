import {
  pointerWithin,
  closestCenter,
  type CollisionDetection,
} from '@dnd-kit/core';

/**
 * Custom collision detection: pointerWithin first, closestCenter fallback.
 *
 * pointerWithin — activates when pointer is inside a droppable rect.
 * More reliable than rectIntersection for small draggable items
 * (e.g. ScratchPad thumbnails w-20 h-[45px]) dropped on larger targets.
 *
 * closestCenter — fallback when pointer isn't inside any droppable.
 * Ensures a drop target is always found when dragging near edges.
 */
export const pointerWithinThenClosest: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  if (pointerCollisions.length > 0) {
    // Prioritize scratchpad over grid-area when both overlap (z-index aware)
    const scratchpadCollision = pointerCollisions.find(
      (c) => c.id === 'drop-scratchpad'
    );
    if (scratchpadCollision) return [scratchpadCollision];
    return pointerCollisions;
  }
  // Exclude ScratchPad SortableContext droppables (drag-card-*) from
  // closestCenter fallback. Without this filter, dragging from a docked
  // ScratchPad across the gap to the grid causes closestCenter to pick a
  // nearby sortable card as the drop target, triggering an internal reorder
  // instead of a cross-context move to the grid.
  const filtered = args.droppableContainers.filter(
    (c) => !String(c.id).startsWith('drag-card-')
  );
  return closestCenter({ ...args, droppableContainers: filtered });
};
