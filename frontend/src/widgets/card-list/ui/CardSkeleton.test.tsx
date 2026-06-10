/**
 * CP499+ — skeleton tail moved inside CardList's grid. CardSkeletonCell must
 * stay grid-agnostic (no own grid wrapper) so it inherits the host grid's
 * gridColumns; the standalone CardSkeleton block keeps its own grid for the
 * no-cards isLoading state.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { CardSkeleton, CardSkeletonCell } from './CardSkeleton';

describe('CardSkeletonCell (CP499+ grid-internal tail)', () => {
  it('renders a single cell WITHOUT its own grid wrapper', () => {
    const { container } = render(<CardSkeletonCell />);
    const root = container.firstElementChild!;
    expect(root.className).not.toContain('grid');
    expect(root.querySelectorAll('.aspect-video')).toHaveLength(1);
  });

  it('applies the host-passed className (width match with cards)', () => {
    const { container } = render(<CardSkeletonCell className="w-[95%]" />);
    expect(container.firstElementChild!.className).toContain('w-[95%]');
  });
});

describe('CardSkeleton (standalone block)', () => {
  it('renders count cells inside its own grid', () => {
    const { container } = render(<CardSkeleton count={3} />);
    const root = container.firstElementChild!;
    expect(root.className).toContain('grid');
    expect(root.querySelectorAll('.aspect-video')).toHaveLength(3);
  });
});
