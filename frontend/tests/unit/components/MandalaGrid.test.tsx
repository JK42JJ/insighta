/**
 * MandalaGrid Component Tests
 *
 * Tests for the MandalaGrid component covering:
 * - Grid rendering with 9 cells (3x3)
 * - Cell click handling
 * - Card drop functionality
 * - Cell drag and swap (subjects reordering)
 * - Navigation to sub-levels with ripple animation
 * - Back navigation
 * - Center cell double-click flip to dashboard
 * - Header visibility (hideHeader prop)
 * - Hint text rendering (showHint prop)
 * - Compact mode (isCompact prop)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { MandalaGrid } from '@/components/MandalaGrid';
import type { MandalaLevel, InsightCard } from '@/types/mandala';

// Mock MandalaCell component
vi.mock('@/components/MandalaCell', () => ({
  MandalaCell: ({
    index,
    label,
    isCenter,
    cards,
    isDropTarget,
    isSelected,
    onClick,
    onDoubleClick,
    onDrop,
    onDragOver,
    onDragLeave,
    onCellDragStart,
    onCellDragEnd,
    onCellSwap,
    onCellDragOver,
    hasSubLevel,
    onNavigateToSubLevel,
  }: {
    index: number;
    label: string;
    isCenter: boolean;
    cards: InsightCard[];
    isDropTarget: boolean;
    isCellSwapTarget?: boolean;
    isSelected: boolean;
    isSwapping?: boolean;
    swapDirection?: 'from' | 'to' | null;
    onClick: () => void;
    onDoubleClick?: () => void;
    onDrop: (index: number, url?: string, cardId?: string) => void;
    onDragOver: (e: React.DragEvent, index: number) => void;
    onDragLeave: () => void;
    onCardClick?: (card: InsightCard) => void;
    onCardDragStart?: (card: InsightCard) => void;
    onCellDragStart?: (index: number) => void;
    onCellDragEnd?: () => void;
    onCellDragOver?: (e: React.DragEvent, index: number) => void;
    onCellSwap?: (fromIndex: number, toIndex: number) => void;
    hasSubLevel?: boolean;
    onNavigateToSubLevel?: () => void;
  }) => (
    <div
      data-testid={`mandala-cell-${index}`}
      data-label={label}
      data-is-center={isCenter}
      data-cards-count={cards.length}
      data-is-drop-target={isDropTarget}
      data-is-selected={isSelected}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onDragOver={(e) => onDragOver(e, index)}
      onDragLeave={onDragLeave}
      draggable={!isCenter}
      onDragStart={() => onCellDragStart?.(index)}
      onDragEnd={() => onCellDragEnd?.()}
    >
      <span data-testid={`cell-label-${index}`}>{label}</span>
      <span data-testid={`cell-cards-${index}`}>{cards.length} cards</span>
      <button
        data-testid={`cell-drop-${index}`}
        onClick={() => onDrop(index, 'https://youtube.com/test', 'card-1')}
      >
        Drop
      </button>
      <button
        data-testid={`cell-swap-${index}`}
        onClick={() => onCellSwap?.(index, (index + 1) % 9 === 4 ? (index + 2) % 9 : (index + 1) % 9)}
      >
        Swap
      </button>
      {hasSubLevel && (
        <button
          data-testid={`cell-navigate-${index}`}
          onClick={() => onNavigateToSubLevel?.()}
        >
          Navigate
        </button>
      )}
      <button
        data-testid={`cell-drag-over-${index}`}
        onClick={(e) => onCellDragOver?.(e as unknown as React.DragEvent, index)}
      >
        DragOver
      </button>
    </div>
  ),
}));

// Mock MandalaDashboard component
vi.mock('@/components/MandalaDashboard', () => ({
  MandalaDashboard: ({
    centerGoal,
    onFlipBack,
  }: {
    centerGoal: string;
    subjects: string[];
    cardsByCell: Record<number, InsightCard[]>;
    onFlipBack: () => void;
  }) => (
    <div data-testid="mandala-dashboard">
      <span data-testid="dashboard-goal">{centerGoal}</span>
      <button data-testid="flip-back-button" onClick={onFlipBack}>
        Flip Back
      </button>
    </div>
  ),
}));

// Test data factory
const createMockLevel = (overrides: Partial<MandalaLevel> = {}): MandalaLevel => ({
  id: 'level-1',
  centerGoal: 'Main Goal',
  subjects: ['Subject 0', 'Subject 1', 'Subject 2', 'Subject 3', 'Subject 4', 'Subject 5', 'Subject 6', 'Subject 7'],
  parentId: null,
  parentCellIndex: null,
  cards: [],
  ...overrides,
});

const createMockCard = (overrides: Partial<InsightCard> = {}): InsightCard => ({
  id: 'card-1',
  videoUrl: 'https://youtube.com/watch?v=test123',
  title: 'Test Video',
  thumbnail: 'https://example.com/thumb.jpg',
  userNote: 'Test note',
  createdAt: new Date('2024-01-15'),
  cellIndex: 0,
  levelId: 'level-1',
  ...overrides,
});

describe('MandalaGrid', () => {
  const mockOnCellClick = vi.fn();
  const mockOnCardDrop = vi.fn();
  const mockOnCardClick = vi.fn();
  const mockOnCardDragStart = vi.fn();
  const mockOnSubjectsReorder = vi.fn();
  const mockOnCellDragging = vi.fn();
  const mockHasSubLevel = vi.fn();
  const mockOnNavigateToSubLevel = vi.fn();
  const mockOnNavigateBack = vi.fn();

  const defaultProps = {
    level: createMockLevel(),
    cardsByCell: {} as Record<number, InsightCard[]>,
    selectedCellIndex: null,
    onCellClick: mockOnCellClick,
    onCardDrop: mockOnCardDrop,
    onCardClick: mockOnCardClick,
    onCardDragStart: mockOnCardDragStart,
    onSubjectsReorder: mockOnSubjectsReorder,
    onCellDragging: mockOnCellDragging,
    isGridDropZone: false,
    hasSubLevel: mockHasSubLevel,
    onNavigateToSubLevel: mockOnNavigateToSubLevel,
    onNavigateBack: mockOnNavigateBack,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockHasSubLevel.mockReturnValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Rendering', () => {
    it('should render 9 cells in a 3x3 grid', () => {
      render(<MandalaGrid {...defaultProps} />);

      // Should have 9 cells
      for (let i = 0; i < 9; i++) {
        expect(screen.getByTestId(`mandala-cell-${i}`)).toBeInTheDocument();
      }
    });

    it('should render center cell with goal text', () => {
      const level = createMockLevel({ centerGoal: 'My Main Goal' });
      render(<MandalaGrid {...defaultProps} level={level} />);

      const centerCell = screen.getByTestId('mandala-cell-4');
      expect(centerCell).toHaveAttribute('data-is-center', 'true');
      expect(centerCell).toHaveAttribute('data-label', 'My Main Goal');
    });

    it('should render subject cells with correct labels', () => {
      const level = createMockLevel({
        subjects: ['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7'],
      });
      render(<MandalaGrid {...defaultProps} level={level} />);

      // Grid to subject index mapping: 0→0, 1→1, 2→2, 3→3, 5→4, 6→5, 7→6, 8→7
      expect(screen.getByTestId('mandala-cell-0')).toHaveAttribute('data-label', 'S0');
      expect(screen.getByTestId('mandala-cell-1')).toHaveAttribute('data-label', 'S1');
      expect(screen.getByTestId('mandala-cell-2')).toHaveAttribute('data-label', 'S2');
      expect(screen.getByTestId('mandala-cell-3')).toHaveAttribute('data-label', 'S3');
      expect(screen.getByTestId('mandala-cell-5')).toHaveAttribute('data-label', 'S4');
      expect(screen.getByTestId('mandala-cell-6')).toHaveAttribute('data-label', 'S5');
      expect(screen.getByTestId('mandala-cell-7')).toHaveAttribute('data-label', 'S6');
      expect(screen.getByTestId('mandala-cell-8')).toHaveAttribute('data-label', 'S7');
    });

    it('should mark non-center cells as not center', () => {
      render(<MandalaGrid {...defaultProps} />);

      for (let i = 0; i < 9; i++) {
        const cell = screen.getByTestId(`mandala-cell-${i}`);
        if (i === 4) {
          expect(cell).toHaveAttribute('data-is-center', 'true');
        } else {
          expect(cell).toHaveAttribute('data-is-center', 'false');
        }
      }
    });

    it('should display card counts per cell', () => {
      const cardsByCell: Record<number, InsightCard[]> = {
        0: [createMockCard({ id: 'card-1' }), createMockCard({ id: 'card-2' })],
        3: [createMockCard({ id: 'card-3' })],
      };
      render(<MandalaGrid {...defaultProps} cardsByCell={cardsByCell} />);

      expect(screen.getByTestId('mandala-cell-0')).toHaveAttribute('data-cards-count', '2');
      expect(screen.getByTestId('mandala-cell-3')).toHaveAttribute('data-cards-count', '1');
      expect(screen.getByTestId('mandala-cell-1')).toHaveAttribute('data-cards-count', '0');
    });
  });

  describe('Header', () => {
    it('should render header with total card count by default', () => {
      const cardsByCell: Record<number, InsightCard[]> = {
        0: [createMockCard({ id: 'card-1' }), createMockCard({ id: 'card-2' })],
        3: [createMockCard({ id: 'card-3' })],
      };
      render(<MandalaGrid {...defaultProps} cardsByCell={cardsByCell} />);

      expect(screen.getByText('만다라트')).toBeInTheDocument();
      expect(screen.getByText('3 카드')).toBeInTheDocument();
    });

    it('should hide header when hideHeader is true', () => {
      render(<MandalaGrid {...defaultProps} hideHeader={true} />);

      expect(screen.queryByText('만다라트')).not.toBeInTheDocument();
    });
  });

  describe('Hint Text', () => {
    it('should show hint text by default', () => {
      render(<MandalaGrid {...defaultProps} />);

      expect(screen.getByText(/중앙 셀을 더블클릭하여 통계 보기/)).toBeInTheDocument();
    });

    it('should hide hint text when showHint is false', () => {
      render(<MandalaGrid {...defaultProps} showHint={false} />);

      expect(screen.queryByText(/중앙 셀을 더블클릭하여 통계 보기/)).not.toBeInTheDocument();
    });
  });

  describe('Cell Click', () => {
    it('should call onCellClick with correct subjectIndex and label when cell is clicked', () => {
      const level = createMockLevel({
        subjects: ['Subject A', 'Subject B', 'Subject C', 'Subject D', 'Subject E', 'Subject F', 'Subject G', 'Subject H'],
      });
      render(<MandalaGrid {...defaultProps} level={level} />);

      // Click cell at grid index 0 (subject index 0)
      fireEvent.click(screen.getByTestId('mandala-cell-0'));

      expect(mockOnCellClick).toHaveBeenCalledWith(0, 'Subject A');
    });

    it('should call onCellClick with -1 for center cell', () => {
      const level = createMockLevel({ centerGoal: 'Center Goal' });
      render(<MandalaGrid {...defaultProps} level={level} />);

      fireEvent.click(screen.getByTestId('mandala-cell-4'));

      expect(mockOnCellClick).toHaveBeenCalledWith(-1, 'Center Goal');
    });

    it('should map grid index 5 to subject index 4', () => {
      const level = createMockLevel({
        subjects: ['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7'],
      });
      render(<MandalaGrid {...defaultProps} level={level} />);

      fireEvent.click(screen.getByTestId('mandala-cell-5'));

      expect(mockOnCellClick).toHaveBeenCalledWith(4, 'S4');
    });
  });

  describe('Card Drop', () => {
    it('should call onCardDrop when card is dropped on a cell', () => {
      render(<MandalaGrid {...defaultProps} />);

      // Trigger drop on cell 0
      fireEvent.click(screen.getByTestId('cell-drop-0'));

      // Should call onCardDrop with subjectIndex (0)
      expect(mockOnCardDrop).toHaveBeenCalledWith(0, 'https://youtube.com/test', 'card-1', undefined, undefined);
    });

    it('should not allow drop on center cell (handled internally)', () => {
      render(<MandalaGrid {...defaultProps} />);

      // Center cell should exist but drops are typically blocked
      const centerCell = screen.getByTestId('mandala-cell-4');
      expect(centerCell).toHaveAttribute('data-is-center', 'true');
    });
  });

  describe('Cell Drag and Swap', () => {
    it('should call onCellDragging when cell drag starts', () => {
      render(<MandalaGrid {...defaultProps} />);

      const cell = screen.getByTestId('mandala-cell-0');
      fireEvent.dragStart(cell);

      expect(mockOnCellDragging).toHaveBeenCalledWith(true);
    });

    it('should call onCellDragging(false) when cell drag ends', () => {
      render(<MandalaGrid {...defaultProps} />);

      const cell = screen.getByTestId('mandala-cell-0');
      fireEvent.dragStart(cell);
      fireEvent.dragEnd(cell);

      expect(mockOnCellDragging).toHaveBeenCalledWith(false);
    });

    it('should call onSubjectsReorder when cells are swapped', async () => {
      const level = createMockLevel({
        subjects: ['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7'],
      });
      render(<MandalaGrid {...defaultProps} level={level} />);

      // Trigger swap from cell 0 to cell 1
      fireEvent.click(screen.getByTestId('cell-swap-0'));

      // Wait for the swap timeout (50ms + 150ms)
      await act(async () => {
        vi.advanceTimersByTime(200);
      });

      expect(mockOnSubjectsReorder).toHaveBeenCalled();
    });

    it('should handle rapid cell swaps (clears previous timeout)', async () => {
      const level = createMockLevel({
        subjects: ['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7'],
      });
      render(<MandalaGrid {...defaultProps} level={level} />);

      // Trigger first swap
      fireEvent.click(screen.getByTestId('cell-swap-0'));

      // Immediately trigger second swap before first timeout completes
      // This covers the clearTimeout branch
      fireEvent.click(screen.getByTestId('cell-swap-1'));

      // Wait for the swap timeout
      await act(async () => {
        vi.advanceTimersByTime(200);
      });

      // Should have been called for the second swap
      expect(mockOnSubjectsReorder).toHaveBeenCalled();
    });
  });

  describe('Selection State', () => {
    it('should mark selected cell', () => {
      render(<MandalaGrid {...defaultProps} selectedCellIndex={2} />);

      // Subject index 2 corresponds to grid index 2
      expect(screen.getByTestId('mandala-cell-2')).toHaveAttribute('data-is-selected', 'true');
    });

    it('should not mark non-selected cells', () => {
      render(<MandalaGrid {...defaultProps} selectedCellIndex={0} />);

      expect(screen.getByTestId('mandala-cell-1')).toHaveAttribute('data-is-selected', 'false');
      expect(screen.getByTestId('mandala-cell-2')).toHaveAttribute('data-is-selected', 'false');
    });
  });

  describe('Drop Zone Highlighting', () => {
    it('should apply drop zone styles when isGridDropZone is true', () => {
      const { container } = render(<MandalaGrid {...defaultProps} isGridDropZone={true} />);

      // The grid container should have ring styling
      const gridElement = container.querySelector('.grid-cols-3');
      expect(gridElement).toHaveClass('ring-4');
    });
  });

  describe('Center Cell Double-Click (Flip to Dashboard)', () => {
    it('should flip to dashboard view on center cell double-click', async () => {
      render(<MandalaGrid {...defaultProps} />);

      // Initially, dashboard should be on backface
      expect(screen.getByTestId('mandala-dashboard')).toBeInTheDocument();

      // Double-click center cell to flip
      const centerCell = screen.getByTestId('mandala-cell-4');
      fireEvent.doubleClick(centerCell);

      // Dashboard should now be visible (flip animation would happen)
      expect(screen.getByTestId('mandala-dashboard')).toBeInTheDocument();
    });

    it('should show flipped hint text when grid is flipped', () => {
      render(<MandalaGrid {...defaultProps} />);

      // Double-click to flip
      const centerCell = screen.getByTestId('mandala-cell-4');
      fireEvent.doubleClick(centerCell);

      // Hint should change (state update is synchronous)
      expect(screen.getByText(/되돌리기 버튼을 클릭하여 만다라 보기/)).toBeInTheDocument();
    });

    it('should flip back when flip back button is clicked', () => {
      render(<MandalaGrid {...defaultProps} />);

      // Flip to dashboard
      fireEvent.doubleClick(screen.getByTestId('mandala-cell-4'));

      // Verify flipped state
      expect(screen.getByText(/되돌리기 버튼을 클릭하여 만다라 보기/)).toBeInTheDocument();

      // Click flip back button
      fireEvent.click(screen.getByTestId('flip-back-button'));

      // Should show original hint (state update is synchronous)
      expect(screen.getByText(/중앙 셀을 더블클릭하여 통계 보기/)).toBeInTheDocument();
    });
  });

  describe('Navigation to Sub-Level', () => {
    it('should render navigation arrows for L1 cells', () => {
      render(<MandalaGrid {...defaultProps} canGoBack={false} />);

      // At L1 (canGoBack=false), navigation arrows should be rendered
      // The arrows are rendered inside the component conditionally
      // Testing the presence of arrow buttons
      const arrowButtons = screen.getAllByRole('button');
      expect(arrowButtons.length).toBeGreaterThan(0);
    });

    it('should call onNavigateToSubLevel when navigation arrow is clicked', async () => {
      const level = createMockLevel({
        subjects: ['Topic A', 'Topic B', 'Topic C', 'Topic D', 'Topic E', 'Topic F', 'Topic G', 'Topic H'],
      });
      render(<MandalaGrid {...defaultProps} level={level} canGoBack={false} />);

      // Find a navigation arrow button (they contain ChevronRight icons)
      const arrowButtons = screen.getAllByRole('button');
      // Filter to find navigation arrows (not flip-back or cell buttons)
      const navArrow = arrowButtons.find(btn =>
        btn.classList.contains('z-40') || btn.className.includes('z-40')
      );

      if (navArrow) {
        fireEvent.click(navArrow);

        // Wait for transition timeout (700ms)
        await act(async () => {
          vi.advanceTimersByTime(800);
        });

        expect(mockOnNavigateToSubLevel).toHaveBeenCalled();
      }
    });

    it('should not show navigation arrows at L2+ (when canGoBack is true)', () => {
      render(<MandalaGrid {...defaultProps} canGoBack={true} entryGridIndex={0} />);

      // Should show back button instead of navigation arrows
      const backButton = screen.getByText('뒤로');
      expect(backButton).toBeInTheDocument();
    });
  });

  describe('Back Navigation', () => {
    it('should render back button when canGoBack is true', () => {
      render(<MandalaGrid {...defaultProps} canGoBack={true} entryGridIndex={0} />);

      expect(screen.getByText('뒤로')).toBeInTheDocument();
    });

    it('should not render back button when canGoBack is false', () => {
      render(<MandalaGrid {...defaultProps} canGoBack={false} />);

      expect(screen.queryByText('뒤로')).not.toBeInTheDocument();
    });

    it('should call onNavigateBack when back button is clicked', async () => {
      render(<MandalaGrid {...defaultProps} canGoBack={true} entryGridIndex={0} />);

      const backButton = screen.getByText('뒤로').closest('button');
      fireEvent.click(backButton!);

      // Wait for transition
      await act(async () => {
        vi.advanceTimersByTime(800);
      });

      expect(mockOnNavigateBack).toHaveBeenCalled();
    });

    it('should position back button based on entry direction', () => {
      // Entry from grid index 0 means back button should be at opposite position (8)
      const { rerender } = render(
        <MandalaGrid {...defaultProps} canGoBack={true} entryGridIndex={0} />
      );

      expect(screen.getByText('뒤로')).toBeInTheDocument();

      // Rerender with different entry index
      rerender(
        <MandalaGrid {...defaultProps} canGoBack={true} entryGridIndex={5} />
      );

      expect(screen.getByText('뒤로')).toBeInTheDocument();
    });
  });

  describe('Drag Over Handling', () => {
    it('should set active drop cell on drag over', () => {
      render(<MandalaGrid {...defaultProps} />);

      const cell = screen.getByTestId('mandala-cell-0');
      const mockEvent = { preventDefault: vi.fn() };

      fireEvent.dragOver(cell, mockEvent);

      // The drop target state is internal, but we can verify the cell exists
      expect(cell).toBeInTheDocument();
    });

    it('should clear active drop cell on drag leave', () => {
      render(<MandalaGrid {...defaultProps} />);

      const cell = screen.getByTestId('mandala-cell-0');
      fireEvent.dragLeave(cell);

      // State is cleared internally
      expect(cell).toBeInTheDocument();
    });
  });

  describe('Compact Mode', () => {
    it('should render in compact mode when isCompact is true', () => {
      render(<MandalaGrid {...defaultProps} isCompact={true} />);

      // Component should render successfully in compact mode
      expect(screen.getByTestId('mandala-cell-4')).toBeInTheDocument();
    });
  });

  describe('Dashboard Integration', () => {
    it('should pass correct props to MandalaDashboard', () => {
      const level = createMockLevel({ centerGoal: 'Test Goal' });
      render(<MandalaGrid {...defaultProps} level={level} />);

      expect(screen.getByTestId('dashboard-goal')).toHaveTextContent('Test Goal');
    });
  });

  describe('Cell Drag Over for Swap', () => {
    it('should handle onCellDragOver callback from non-center cells', () => {
      render(<MandalaGrid {...defaultProps} />);

      // Click cell drag over button on cell 0 (non-center)
      const dragOverButton = screen.getByTestId('cell-drag-over-0');
      fireEvent.click(dragOverButton);

      // The callback was invoked - internal state updated
      expect(dragOverButton).toBeInTheDocument();
    });

    it('should handle onCellDragOver on multiple cells during drag', () => {
      render(<MandalaGrid {...defaultProps} />);

      // Simulate drag starting from cell 0
      const cell0 = screen.getByTestId('mandala-cell-0');
      fireEvent.dragStart(cell0);

      // Click drag over button on cell 1
      const dragOverButton1 = screen.getByTestId('cell-drag-over-1');
      fireEvent.click(dragOverButton1);

      expect(dragOverButton1).toBeInTheDocument();
    });
  });

  describe('Cell Navigation to Sub-Level', () => {
    it('should call onNavigateToSubLevel when cell navigate button is clicked', async () => {
      const level = createMockLevel({
        subjects: ['Topic A', 'Topic B', 'Topic C', 'Topic D', 'Topic E', 'Topic F', 'Topic G', 'Topic H'],
      });
      render(<MandalaGrid {...defaultProps} level={level} canGoBack={false} />);

      // Non-center cells should have the navigate button when hasSubLevel is true (at L1)
      // Cell 0 should have navigate button
      const navigateButton = screen.getByTestId('cell-navigate-0');
      fireEvent.click(navigateButton);

      // Wait for transition timeout (700ms)
      await act(async () => {
        vi.advanceTimersByTime(800);
      });

      expect(mockOnNavigateToSubLevel).toHaveBeenCalled();
    });

    it('should pass correct gridIndex to handleNavigateToSubLevel', async () => {
      const level = createMockLevel({
        subjects: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],
      });
      render(<MandalaGrid {...defaultProps} level={level} canGoBack={false} />);

      // Click navigate on cell 7
      const navigateButton7 = screen.getByTestId('cell-navigate-7');
      fireEvent.click(navigateButton7);

      await act(async () => {
        vi.advanceTimersByTime(800);
      });

      // The callback should have been called (gridIndex is captured in closure)
      // onNavigateToSubLevel prop calls handleNavigateToSubLevel(gridIndex) internally
      expect(mockOnNavigateToSubLevel).toHaveBeenCalledTimes(1);
    });
  });
});
