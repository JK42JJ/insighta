import { describe, it, expect, vi } from 'vitest';

// Mock dnd-kit core before importing our module
vi.mock('@dnd-kit/core', () => ({
  pointerWithin: vi.fn(),
  closestCenter: vi.fn(),
}));

import { pointerWithinThenClosest } from '@shared/lib/dnd/collisionDetection';
import { pointerWithin, closestCenter } from '@dnd-kit/core';

const mockedPointerWithin = vi.mocked(pointerWithin);
const mockedClosestCenter = vi.mocked(closestCenter);

function makeCollision(id: string) {
  return { id, data: { droppableContainer: { id } } } as never;
}

function makeDroppable(id: string) {
  return { id } as never;
}

const baseArgs = {
  active: { id: 'drag-1' } as never,
  collisionRect: {} as never,
  droppableRects: new Map(),
  droppableContainers: [
    makeDroppable('drop-scratchpad'),
    makeDroppable('drop-cell-0'),
    makeDroppable('drag-card-1'),
    makeDroppable('drag-card-2'),
  ],
  pointerCoordinates: { x: 100, y: 100 },
} as never;

describe('pointerWithinThenClosest', () => {
  it('returns pointerWithin results when collisions found', () => {
    const collision = makeCollision('drop-cell-0');
    mockedPointerWithin.mockReturnValue([collision]);

    const result = pointerWithinThenClosest(baseArgs);
    expect(result).toEqual([collision]);
    expect(mockedClosestCenter).not.toHaveBeenCalled();
  });

  it('prioritizes scratchpad when overlapping with other droppables', () => {
    const scratchpadCollision = makeCollision('drop-scratchpad');
    const cellCollision = makeCollision('drop-cell-0');
    mockedPointerWithin.mockReturnValue([
      cellCollision,
      scratchpadCollision,
    ]);

    const result = pointerWithinThenClosest(baseArgs);
    expect(result).toEqual([scratchpadCollision]);
  });

  it('falls back to closestCenter when no pointerWithin collisions', () => {
    mockedPointerWithin.mockReturnValue([]);
    const fallbackCollision = makeCollision('drop-cell-0');
    mockedClosestCenter.mockReturnValue([fallbackCollision]);

    const result = pointerWithinThenClosest(baseArgs);
    expect(result).toEqual([fallbackCollision]);
  });

  it('filters drag-card-* droppables from closestCenter fallback', () => {
    mockedPointerWithin.mockReturnValue([]);
    mockedClosestCenter.mockReturnValue([]);

    pointerWithinThenClosest(baseArgs);

    const closestCenterCall = mockedClosestCenter.mock.calls[0][0] as {
      droppableContainers: { id: string }[];
    };
    const ids = closestCenterCall.droppableContainers.map(
      (c: { id: string }) => c.id
    );
    expect(ids).not.toContain('drag-card-1');
    expect(ids).not.toContain('drag-card-2');
    expect(ids).toContain('drop-scratchpad');
    expect(ids).toContain('drop-cell-0');
  });
});
