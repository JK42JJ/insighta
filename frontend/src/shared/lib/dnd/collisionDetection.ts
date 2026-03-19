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
  if (pointerCollisions.length > 0) return pointerCollisions;
  return closestCenter(args);
};
