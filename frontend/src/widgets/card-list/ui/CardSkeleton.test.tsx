/**
 * CP499+ — skeleton cells are grid-agnostic BY DESIGN: CardSkeleton.tsx owns
 * no grid. All render sites (initial-load + lazy-pagination tail) place the
 * cells inside CardList's shared card grid (CARD_GRID_CLASS/cardGridStyle) so
 * skeleton columns always match the user's gridColumns. The old standalone
 * block with its own breakpoint grid was the 4-col vs 3-col mismatch defect.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { CardSkeletonCell } from './CardSkeleton';

describe('CardSkeletonCell (CP499+ grid-agnostic invariant)', () => {
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

  it('the module exports NO standalone grid block (regression guard)', async () => {
    const mod = await import('./CardSkeleton');
    expect(Object.keys(mod)).toEqual(['CardSkeletonCell']);
  });
});
