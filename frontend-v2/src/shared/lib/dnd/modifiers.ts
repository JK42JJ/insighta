import type { Modifier } from '@dnd-kit/core';

/**
 * Positions the DragOverlay so the cursor is near the top-left corner.
 * Works correctly even when source elements are inside CSS 3D transform
 * containers (perspective, preserve-3d) because activeNodeRect.left/top
 * cancel out in the final position calculation.
 */
export const snapToCursor: Modifier = ({
  activatorEvent,
  activeNodeRect,
  transform,
}) => {
  if (activatorEvent && activeNodeRect) {
    const coords = getEventCoordinates(activatorEvent);
    if (coords) {
      // offset so overlay top-left is near the cursor with a small gap
      const offsetX = coords.x - activeNodeRect.left - 12;
      const offsetY = coords.y - activeNodeRect.top - 12;
      return {
        ...transform,
        x: transform.x + offsetX,
        y: transform.y + offsetY,
      };
    }
  }
  return transform;
};

function getEventCoordinates(event: Event): { x: number; y: number } | null {
  if (event instanceof MouseEvent) {
    return { x: event.clientX, y: event.clientY };
  }
  if (typeof TouchEvent !== 'undefined' && event instanceof TouchEvent && event.touches[0]) {
    return { x: event.touches[0].clientX, y: event.touches[0].clientY };
  }
  return null;
}
