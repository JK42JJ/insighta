/**
 * CardList Component Tests
 *
 * Tests for the CardList component covering:
 * - Empty state rendering
 * - Card sorting (by sortOrder and createdAt)
 * - Multi-selection (Ctrl+Click, Ctrl+Shift+Click)
 * - Keyboard navigation (ESC to clear)
 * - Click outside to clear selection
 * - Delete selected cards
 * - Drag and drop reordering
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { CardList } from '@/components/CardList';
import type { InsightCard } from '@/types/mandala';

// Mock useDragSelect hook
const mockUseDragSelect = vi.fn();
vi.mock('@/hooks/useDragSelect', () => ({
  useDragSelect: (options: { onSelectionChange?: (indices: number[]) => void }) => {
    mockUseDragSelect(options);
    return {
      selectionStyle: null,
      justFinishedDrag: false,
      isDragging: false,
    };
  },
}));

// Mock InsightCardItem to simplify testing
vi.mock('@/components/InsightCardItem', () => ({
  InsightCardItem: ({
    card,
    onClick,
    onCtrlClick,
    onInternalDragStart,
  }: {
    card: InsightCard;
    onClick?: () => void;
    onCtrlClick?: (e: React.MouseEvent) => void;
    onInternalDragStart?: (e: React.DragEvent) => void;
  }) => (
    <div
      data-testid={`insight-card-${card.id}`}
      onClick={onClick}
      onMouseDown={(e) => {
        // Simulate ctrl+click behavior
        if (e.ctrlKey || e.metaKey) {
          onCtrlClick?.(e as unknown as React.MouseEvent);
        }
      }}
      draggable
      onDragStart={(e) => onInternalDragStart?.(e as unknown as React.DragEvent)}
    >
      <span data-testid={`card-title-${card.id}`}>{card.title}</span>
    </div>
  ),
}));

// Test data factory
const createMockCard = (overrides: Partial<InsightCard> = {}): InsightCard => ({
  id: 'card-1',
  videoUrl: 'https://youtube.com/watch?v=test',
  title: 'Test Card',
  thumbnail: 'https://example.com/thumb.jpg',
  userNote: 'Test note',
  createdAt: new Date('2024-01-15'),
  cellIndex: 0,
  levelId: 'level-1',
  ...overrides,
});

describe('CardList', () => {
  const mockOnCardClick = vi.fn();
  const mockOnCardDragStart = vi.fn();
  const mockOnMultiCardDragStart = vi.fn();
  const mockOnSaveNote = vi.fn();
  const mockOnCardsReorder = vi.fn();
  const mockOnDeleteCards = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Empty State', () => {
    it('should render empty state when no cards are provided', () => {
      render(<CardList cards={[]} title="테스트" />);

      expect(screen.getByText('아직 저장된 인사이트가 없습니다')).toBeInTheDocument();
      expect(screen.getByText('유튜브 링크를 드래그하여 추가하세요')).toBeInTheDocument();
    });

    it('should display FileVideo icon in empty state', () => {
      const { container } = render(<CardList cards={[]} title="테스트" />);

      // Check for SVG element (lucide-react icon)
      const svgElements = container.querySelectorAll('svg');
      expect(svgElements.length).toBeGreaterThan(0);
    });
  });

  describe('Card Rendering', () => {
    it('should render cards with title', () => {
      const cards = [
        createMockCard({ id: 'card-1', title: 'First Card' }),
        createMockCard({ id: 'card-2', title: 'Second Card' }),
      ];

      render(<CardList cards={cards} title="테스트" />);

      expect(screen.getByTestId('insight-card-card-1')).toBeInTheDocument();
      expect(screen.getByTestId('insight-card-card-2')).toBeInTheDocument();
      expect(screen.getByText('테스트 인사이트')).toBeInTheDocument();
    });

    it('should render drag hint text', () => {
      const cards = [createMockCard()];
      render(<CardList cards={cards} title="테스트" />);

      expect(screen.getByText('드래그하여 이동')).toBeInTheDocument();
      expect(screen.getByText('최신순')).toBeInTheDocument();
    });
  });

  describe('Sorting Logic', () => {
    it('should sort cards by sortOrder when available', () => {
      const cards = [
        createMockCard({ id: 'card-c', title: 'Card C', sortOrder: 2 }),
        createMockCard({ id: 'card-a', title: 'Card A', sortOrder: 0 }),
        createMockCard({ id: 'card-b', title: 'Card B', sortOrder: 1 }),
      ];

      render(<CardList cards={cards} title="테스트" />);

      const cardItems = screen.getAllByTestId(/^insight-card-/);
      expect(cardItems[0]).toHaveAttribute('data-testid', 'insight-card-card-a');
      expect(cardItems[1]).toHaveAttribute('data-testid', 'insight-card-card-b');
      expect(cardItems[2]).toHaveAttribute('data-testid', 'insight-card-card-c');
    });

    it('should sort cards by createdAt (newest first) when sortOrder is not available', () => {
      const cards = [
        createMockCard({ id: 'card-old', title: 'Old Card', createdAt: new Date('2024-01-01') }),
        createMockCard({ id: 'card-new', title: 'New Card', createdAt: new Date('2024-01-15') }),
        createMockCard({ id: 'card-mid', title: 'Mid Card', createdAt: new Date('2024-01-10') }),
      ];

      render(<CardList cards={cards} title="테스트" />);

      const cardItems = screen.getAllByTestId(/^insight-card-/);
      expect(cardItems[0]).toHaveAttribute('data-testid', 'insight-card-card-new');
      expect(cardItems[1]).toHaveAttribute('data-testid', 'insight-card-card-mid');
      expect(cardItems[2]).toHaveAttribute('data-testid', 'insight-card-card-old');
    });

    it('should prefer sortOrder over createdAt when sortOrder exists', () => {
      const cards = [
        createMockCard({ id: 'card-1', sortOrder: 1, createdAt: new Date('2024-01-15') }),
        createMockCard({ id: 'card-2', sortOrder: 0, createdAt: new Date('2024-01-01') }),
      ];

      render(<CardList cards={cards} title="테스트" />);

      const cardItems = screen.getAllByTestId(/^insight-card-/);
      // Card with sortOrder: 0 should be first despite older date
      expect(cardItems[0]).toHaveAttribute('data-testid', 'insight-card-card-2');
      expect(cardItems[1]).toHaveAttribute('data-testid', 'insight-card-card-1');
    });
  });

  describe('Selection with Click', () => {
    it('should call onCardClick on normal click', () => {
      const cards = [createMockCard({ id: 'card-1' })];

      render(
        <CardList
          cards={cards}
          title="테스트"
          onCardClick={mockOnCardClick}
        />
      );

      fireEvent.click(screen.getByTestId('insight-card-card-1'));
      expect(mockOnCardClick).toHaveBeenCalledWith(cards[0]);
    });

    it('should toggle selection on Ctrl+Click', () => {
      const cards = [
        createMockCard({ id: 'card-1' }),
        createMockCard({ id: 'card-2' }),
      ];

      render(
        <CardList
          cards={cards}
          title="테스트"
          onCardClick={mockOnCardClick}
        />
      );

      // Ctrl+Click on first card
      fireEvent.mouseDown(screen.getByTestId('insight-card-card-1'), { ctrlKey: true });

      // Selection badge should appear
      expect(screen.getByText('1개 선택됨')).toBeInTheDocument();

      // Ctrl+Click on second card
      fireEvent.mouseDown(screen.getByTestId('insight-card-card-2'), { ctrlKey: true });

      expect(screen.getByText('2개 선택됨')).toBeInTheDocument();
    });

    it('should work with Meta key (Mac Cmd)', () => {
      const cards = [createMockCard({ id: 'card-1' })];

      render(<CardList cards={cards} title="테스트" />);

      fireEvent.mouseDown(screen.getByTestId('insight-card-card-1'), { metaKey: true });

      expect(screen.getByText('1개 선택됨')).toBeInTheDocument();
    });
  });

  describe('Keyboard Navigation', () => {
    it('should clear selection on ESC key', () => {
      const cards = [
        createMockCard({ id: 'card-1' }),
        createMockCard({ id: 'card-2' }),
      ];

      render(<CardList cards={cards} title="테스트" />);

      // Select a card
      fireEvent.mouseDown(screen.getByTestId('insight-card-card-1'), { ctrlKey: true });
      expect(screen.getByText('1개 선택됨')).toBeInTheDocument();

      // Press ESC
      fireEvent.keyDown(document, { key: 'Escape' });

      expect(screen.queryByText(/개 선택됨/)).not.toBeInTheDocument();
    });
  });

  describe('Click Outside', () => {
    it('should clear selection when clicking outside container', () => {
      const cards = [createMockCard({ id: 'card-1' })];

      render(
        <div>
          <div data-testid="outside-element">Outside</div>
          <CardList cards={cards} title="테스트" />
        </div>
      );

      // Select a card
      fireEvent.mouseDown(screen.getByTestId('insight-card-card-1'), { ctrlKey: true });
      expect(screen.getByText('1개 선택됨')).toBeInTheDocument();

      // Click outside
      fireEvent.click(screen.getByTestId('outside-element'));

      expect(screen.queryByText(/개 선택됨/)).not.toBeInTheDocument();
    });
  });

  describe('Delete Selected Cards', () => {
    it('should show delete button when cards are selected', () => {
      const cards = [createMockCard({ id: 'card-1' })];

      render(
        <CardList
          cards={cards}
          title="테스트"
          onDeleteCards={mockOnDeleteCards}
        />
      );

      // Select a card
      fireEvent.mouseDown(screen.getByTestId('insight-card-card-1'), { ctrlKey: true });

      // Delete button should be visible
      const deleteButton = screen.getByTitle('선택된 카드 삭제');
      expect(deleteButton).toBeInTheDocument();
    });

    it('should call onDeleteCards with selected card IDs when delete button is clicked', () => {
      const cards = [
        createMockCard({ id: 'card-1' }),
        createMockCard({ id: 'card-2' }),
      ];

      render(
        <CardList
          cards={cards}
          title="테스트"
          onDeleteCards={mockOnDeleteCards}
        />
      );

      // Select both cards
      fireEvent.mouseDown(screen.getByTestId('insight-card-card-1'), { ctrlKey: true });
      fireEvent.mouseDown(screen.getByTestId('insight-card-card-2'), { ctrlKey: true });

      expect(screen.getByText('2개 선택됨')).toBeInTheDocument();

      // Click delete
      fireEvent.click(screen.getByTitle('선택된 카드 삭제'));

      expect(mockOnDeleteCards).toHaveBeenCalledWith(['card-1', 'card-2']);
    });

    it('should clear selection after delete', () => {
      const cards = [createMockCard({ id: 'card-1' })];

      render(
        <CardList
          cards={cards}
          title="테스트"
          onDeleteCards={mockOnDeleteCards}
        />
      );

      // Select and delete
      fireEvent.mouseDown(screen.getByTestId('insight-card-card-1'), { ctrlKey: true });
      fireEvent.click(screen.getByTitle('선택된 카드 삭제'));

      // Selection should be cleared
      expect(screen.queryByText(/개 선택됨/)).not.toBeInTheDocument();
    });
  });

  describe('Selection Indicator', () => {
    it('should show check icon on selected cards', () => {
      const cards = [createMockCard({ id: 'card-1' })];

      const { container } = render(<CardList cards={cards} title="테스트" />);

      // Before selection - no selection badge
      expect(screen.queryByText(/개 선택됨/)).not.toBeInTheDocument();

      // Select a card
      fireEvent.mouseDown(screen.getByTestId('insight-card-card-1'), { ctrlKey: true });

      // Check icon should appear - we look for the selection indicator that has a Check icon
      // The indicator has title="선택 해제" and contains a Check icon
      const checkIndicator = screen.getByTitle('선택 해제');
      expect(checkIndicator).toBeInTheDocument();
      expect(checkIndicator).toHaveClass('bg-primary', 'rounded-full');
    });

    it('should allow deselection by clicking the check indicator', () => {
      const cards = [createMockCard({ id: 'card-1' })];

      const { container } = render(<CardList cards={cards} title="테스트" />);

      // Select a card
      fireEvent.mouseDown(screen.getByTestId('insight-card-card-1'), { ctrlKey: true });
      expect(screen.getByText('1개 선택됨')).toBeInTheDocument();

      // Click on the check indicator to deselect
      const checkIndicator = container.querySelector('.bg-primary.rounded-full');
      expect(checkIndicator).not.toBeNull();
      fireEvent.click(checkIndicator!);

      expect(screen.queryByText(/개 선택됨/)).not.toBeInTheDocument();
    });
  });

  describe('Selection Clearing on Cards Change', () => {
    it('should filter out selected IDs that no longer exist in cards', () => {
      const initialCards = [
        createMockCard({ id: 'card-1' }),
        createMockCard({ id: 'card-2' }),
      ];

      const { rerender } = render(<CardList cards={initialCards} title="테스트" />);

      // Select both cards
      fireEvent.mouseDown(screen.getByTestId('insight-card-card-1'), { ctrlKey: true });
      fireEvent.mouseDown(screen.getByTestId('insight-card-card-2'), { ctrlKey: true });
      expect(screen.getByText('2개 선택됨')).toBeInTheDocument();

      // Remove one card
      const updatedCards = [createMockCard({ id: 'card-1' })];
      rerender(<CardList cards={updatedCards} title="테스트" />);

      // Only one should remain selected
      expect(screen.getByText('1개 선택됨')).toBeInTheDocument();
    });
  });

  describe('Drag Select Integration', () => {
    it('should pass containerRef to useDragSelect', () => {
      const cards = [createMockCard()];
      render(<CardList cards={cards} title="테스트" />);

      expect(mockUseDragSelect).toHaveBeenCalled();
      const callArgs = mockUseDragSelect.mock.calls[0][0];
      expect(callArgs).toHaveProperty('containerRef');
      expect(callArgs).toHaveProperty('itemSelector', '[data-card-item]');
      expect(callArgs).toHaveProperty('onSelectionChange');
      expect(callArgs).toHaveProperty('enabled', true);
    });
  });

  describe('Drag and Drop Reordering', () => {
    it('should handle drag over event', () => {
      const cards = [
        createMockCard({ id: 'card-1' }),
        createMockCard({ id: 'card-2' }),
      ];

      const { container } = render(
        <CardList
          cards={cards}
          title="테스트"
          onCardsReorder={mockOnCardsReorder}
        />
      );

      const cardWrapper = container.querySelector('[data-card-item]');
      expect(cardWrapper).not.toBeNull();

      // Simulate dragover
      const dataTransfer = {
        types: ['application/card-reorder'],
        getData: vi.fn(),
        setData: vi.fn(),
        effectAllowed: 'move',
      };

      fireEvent.dragOver(cardWrapper!, {
        dataTransfer,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      });
    });

    it('should handle drop event and reorder cards', () => {
      const cards = [
        createMockCard({ id: 'card-1', sortOrder: 0 }),
        createMockCard({ id: 'card-2', sortOrder: 1 }),
        createMockCard({ id: 'card-3', sortOrder: 2 }),
      ];

      const { container } = render(
        <CardList
          cards={cards}
          title="테스트"
          onCardsReorder={mockOnCardsReorder}
        />
      );

      const cardWrappers = container.querySelectorAll('[data-card-item]');
      const targetCard = cardWrappers[2]; // Drop on third card

      const dataTransfer = {
        types: ['application/card-reorder'],
        getData: vi.fn().mockReturnValue('card-1'),
        setData: vi.fn(),
        effectAllowed: 'move',
      };

      // Perform drop
      fireEvent.drop(targetCard, {
        dataTransfer,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      });

      expect(mockOnCardsReorder).toHaveBeenCalled();
      const reorderedCards = mockOnCardsReorder.mock.calls[0][0];
      // Card 1 should now be at position 2 (after cards 2 and 3)
      expect(reorderedCards[0].id).toBe('card-2');
      expect(reorderedCards[1].id).toBe('card-3');
      expect(reorderedCards[2].id).toBe('card-1');
      // Each should have updated sortOrder
      expect(reorderedCards[0].sortOrder).toBe(0);
      expect(reorderedCards[1].sortOrder).toBe(1);
      expect(reorderedCards[2].sortOrder).toBe(2);
    });

    it('should not reorder when dropping card on itself', () => {
      const cards = [
        createMockCard({ id: 'card-1', sortOrder: 0 }),
        createMockCard({ id: 'card-2', sortOrder: 1 }),
      ];

      const { container } = render(
        <CardList
          cards={cards}
          title="테스트"
          onCardsReorder={mockOnCardsReorder}
        />
      );

      const cardWrappers = container.querySelectorAll('[data-card-item]');
      const firstCard = cardWrappers[0];

      const dataTransfer = {
        types: ['application/card-reorder'],
        getData: vi.fn().mockReturnValue('card-1'),
        setData: vi.fn(),
      };

      fireEvent.drop(firstCard, {
        dataTransfer,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      });

      expect(mockOnCardsReorder).not.toHaveBeenCalled();
    });

    it('should handle drag leave event', () => {
      const cards = [createMockCard({ id: 'card-1' })];

      const { container } = render(<CardList cards={cards} title="테스트" />);

      const cardWrapper = container.querySelector('[data-card-item]');
      expect(cardWrapper).not.toBeNull();

      // Should not throw
      fireEvent.dragLeave(cardWrapper!);
    });
  });

  describe('Container Click Behavior', () => {
    it('should clear selection when clicking on empty space in grid', () => {
      const cards = [createMockCard({ id: 'card-1' })];

      const { container } = render(<CardList cards={cards} title="테스트" />);

      // Select a card
      fireEvent.mouseDown(screen.getByTestId('insight-card-card-1'), { ctrlKey: true });
      expect(screen.getByText('1개 선택됨')).toBeInTheDocument();

      // Find the grid container and click on it (not on a card)
      const gridContainer = container.querySelector('.grid');
      expect(gridContainer).not.toBeNull();

      // Click directly on grid, not on a card element
      fireEvent.click(gridContainer!, {
        target: gridContainer,
      });

      expect(screen.queryByText(/개 선택됨/)).not.toBeInTheDocument();
    });
  });
});
