/**
 * W1b (CP499+) — empty sub-level cells show a "filling" pulse while the
 * actions-fill pg-boss job is in flight (instead of permanently blank).
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MandalaCell } from './MandalaCell';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, d: string) => d }),
}));

const baseProps = {
  index: 1,
  isCenter: false,
  cards: [],
  isDropTarget: false,
  isCellSwapTarget: false,
  isSelected: false,
  isSwapping: false,
  swapDirection: null,
  sizeMode: 'normal' as const,
  totalCards: 0,
  avatarSeed: 'seed',
  hasSubLevel: false,
  onClick: vi.fn(),
  onCardDrop: vi.fn(),
  onCardClick: vi.fn(),
  onCardDragStart: vi.fn(),
  onCellDragging: vi.fn(),
};

describe('MandalaCell — W1b actions filling state', () => {
  it('empty label + pending → shows the filling pulse', () => {
    const { getByText } = render(<MandalaCell {...baseProps} label="" isActionsPending />);
    expect(getByText('Filling…')).toBeTruthy();
  });

  it('empty label + NOT pending → stays blank (no placeholder)', () => {
    const { queryByText } = render(<MandalaCell {...baseProps} label="" />);
    expect(queryByText('Filling…')).toBeNull();
  });

  it('filled label + pending → label wins, no placeholder', () => {
    const { queryByText, getByText } = render(
      <MandalaCell {...baseProps} label="실천 항목" isActionsPending />
    );
    expect(getByText('실천 항목')).toBeTruthy();
    expect(queryByText('Filling…')).toBeNull();
  });
});
