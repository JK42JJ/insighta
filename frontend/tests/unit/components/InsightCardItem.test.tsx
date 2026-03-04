/**
 * InsightCardItem Component Tests
 *
 * Tests for the InsightCardItem component covering:
 * - Rendering (front side with thumbnail, title, note)
 * - Card flip animation
 * - Ctrl+Click for multi-select
 * - Note editing and saving
 * - Drag functionality
 * - Markdown link rendering
 * - Video modal integration
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { InsightCardItem } from '@/components/InsightCardItem';
import type { InsightCard } from '@/types/mandala';

// Mock VideoPlayerModal
vi.mock('@/components/VideoPlayerModal', () => ({
  VideoPlayerModal: ({
    isOpen,
    onClose,
  }: {
    card: InsightCard;
    isOpen: boolean;
    onClose: () => void;
    onSave?: (id: string, note: string) => void;
  }) => (
    isOpen ? (
      <div data-testid="video-player-modal">
        <button data-testid="close-modal" onClick={onClose}>Close</button>
      </div>
    ) : null
  ),
}));

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Test data factory
const createMockCard = (overrides: Partial<InsightCard> = {}): InsightCard => ({
  id: 'card-1',
  videoUrl: 'https://youtube.com/watch?v=test123',
  title: 'Test Video Title',
  thumbnail: 'https://example.com/thumb.jpg',
  userNote: 'Test note',
  createdAt: new Date('2024-01-15'),
  cellIndex: 0,
  levelId: 'level-1',
  ...overrides,
});

describe('InsightCardItem', () => {
  const mockOnClick = vi.fn();
  const mockOnCtrlClick = vi.fn();
  const mockOnDragStart = vi.fn();
  const mockOnInternalDragStart = vi.fn();
  const mockOnSave = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock window.open
    vi.stubGlobal('open', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('Rendering', () => {
    it('should render card with title', () => {
      const card = createMockCard({ title: 'My Test Video' });
      render(<InsightCardItem card={card} />);

      expect(screen.getByText('My Test Video')).toBeInTheDocument();
    });

    it('should render card with thumbnail', () => {
      const card = createMockCard({ thumbnail: 'https://example.com/thumb.jpg' });
      render(<InsightCardItem card={card} />);

      const img = screen.getByRole('img');
      expect(img).toHaveAttribute('src', 'https://example.com/thumb.jpg');
    });

    it('should render user note on front side', () => {
      const card = createMockCard({ userNote: 'My test note' });
      render(<InsightCardItem card={card} />);

      // Note appears on both front and back sides
      const notes = screen.getAllByText('My test note');
      expect(notes.length).toBeGreaterThanOrEqual(1);
      expect(notes[0]).toBeInTheDocument();
    });

    it('should show placeholder when no note exists', () => {
      const card = createMockCard({ userNote: '' });
      render(<InsightCardItem card={card} />);

      expect(screen.getByText('메모 없음 - 클릭하여 작성')).toBeInTheDocument();
    });

    it('should render date in Korean format', () => {
      const card = createMockCard({ createdAt: new Date('2024-01-15') });
      render(<InsightCardItem card={card} />);

      // Date appears on both front and back sides in Korean format
      const dates = screen.getAllByText('2024. 1. 15.');
      expect(dates.length).toBeGreaterThanOrEqual(1);
      expect(dates[0]).toBeInTheDocument();
    });

    it('should render external link', () => {
      const card = createMockCard({ videoUrl: 'https://youtube.com/watch?v=test123' });
      render(<InsightCardItem card={card} />);

      // Multiple links may exist on both front and back sides
      const links = screen.getAllByRole('link');
      const externalLink = links.find(
        (link) => link.getAttribute('href') === 'https://youtube.com/watch?v=test123'
      );
      expect(externalLink).toBeInTheDocument();
      expect(externalLink).toHaveAttribute('target', '_blank');
    });
  });

  describe('Card Flip', () => {
    it('should flip card on click', () => {
      const card = createMockCard();
      const { container } = render(<InsightCardItem card={card} />);

      // Initially front side is visible
      const frontSide = container.querySelector('.backface-hidden:not(.rotate-y-180)');
      expect(frontSide).not.toHaveClass('invisible');

      // Click to flip
      fireEvent.click(frontSide!);

      // After flip, front should be invisible (handled by class)
      expect(frontSide).toHaveClass('invisible');
    });

    it('should show memo editor on back side when flipped', () => {
      const card = createMockCard();
      const { container } = render(<InsightCardItem card={card} />);

      // Click to flip
      const frontSide = container.querySelector('.backface-hidden:not(.rotate-y-180)');
      fireEvent.click(frontSide!);

      // Memo editor header should be visible
      expect(screen.getByText('메모 편집')).toBeInTheDocument();
    });
  });

  describe('Ctrl+Click Multi-Select', () => {
    it('should call onCtrlClick when Ctrl key is pressed', () => {
      const card = createMockCard();
      const { container } = render(
        <InsightCardItem card={card} onCtrlClick={mockOnCtrlClick} />
      );

      const frontSide = container.querySelector('.backface-hidden:not(.rotate-y-180)');
      fireEvent.click(frontSide!, { ctrlKey: true });

      expect(mockOnCtrlClick).toHaveBeenCalled();
    });

    it('should call onCtrlClick when Meta key is pressed (Mac)', () => {
      const card = createMockCard();
      const { container } = render(
        <InsightCardItem card={card} onCtrlClick={mockOnCtrlClick} />
      );

      const frontSide = container.querySelector('.backface-hidden:not(.rotate-y-180)');
      fireEvent.click(frontSide!, { metaKey: true });

      expect(mockOnCtrlClick).toHaveBeenCalled();
    });

    it('should not flip when Ctrl+Click is used', () => {
      const card = createMockCard();
      const { container } = render(
        <InsightCardItem card={card} onCtrlClick={mockOnCtrlClick} />
      );

      const frontSide = container.querySelector('.backface-hidden:not(.rotate-y-180)');
      fireEvent.click(frontSide!, { ctrlKey: true });

      // Front side should still be visible (not flipped)
      expect(frontSide).not.toHaveClass('invisible');
    });
  });

  describe('Note Editing', () => {
    it('should show textarea when editing', async () => {
      const card = createMockCard({ userNote: 'Existing note' });
      const { container } = render(<InsightCardItem card={card} />);

      // Flip the card
      const frontSide = container.querySelector('.backface-hidden:not(.rotate-y-180)');
      fireEvent.click(frontSide!);

      // Find the back side's editable memo area (has cursor-text class with onClick handler)
      const backSide = container.querySelector('.rotate-y-180');
      const editableArea = backSide?.querySelector('.cursor-text');
      fireEvent.click(editableArea!);

      // Textarea should appear
      const textarea = screen.getByRole('textbox');
      expect(textarea).toBeInTheDocument();
      expect(textarea).toHaveValue('Existing note');
    });

    it('should update note on change', () => {
      const card = createMockCard({ userNote: '' });
      const { container } = render(<InsightCardItem card={card} />);

      // Flip and enter edit mode
      const frontSide = container.querySelector('.backface-hidden:not(.rotate-y-180)');
      fireEvent.click(frontSide!);

      const placeholder = screen.getByText('클릭하여 메모 작성...');
      fireEvent.click(placeholder);

      const textarea = screen.getByRole('textbox');
      fireEvent.change(textarea, { target: { value: 'New note content' } });

      expect(textarea).toHaveValue('New note content');
    });

    it('should call onSave when Enter is pressed', () => {
      const card = createMockCard({ userNote: 'Note to save' });
      const { container } = render(
        <InsightCardItem card={card} onSave={mockOnSave} />
      );

      // Flip and enter edit mode
      const frontSide = container.querySelector('.backface-hidden:not(.rotate-y-180)');
      fireEvent.click(frontSide!);

      // Find the back side's editable memo area
      const backSide = container.querySelector('.rotate-y-180');
      const editableArea = backSide?.querySelector('.cursor-text');
      fireEvent.click(editableArea!);

      const textarea = screen.getByRole('textbox');
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

      expect(mockOnSave).toHaveBeenCalledWith('card-1', 'Note to save');
    });

    it('should not save on Shift+Enter (allows new line)', () => {
      const card = createMockCard({ userNote: 'Note' });
      const { container } = render(
        <InsightCardItem card={card} onSave={mockOnSave} />
      );

      // Flip and enter edit mode
      const frontSide = container.querySelector('.backface-hidden:not(.rotate-y-180)');
      fireEvent.click(frontSide!);

      // Find the back side's editable memo area
      const backSide = container.querySelector('.rotate-y-180');
      const editableArea = backSide?.querySelector('.cursor-text');
      fireEvent.click(editableArea!);

      const textarea = screen.getByRole('textbox');
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });

      expect(mockOnSave).not.toHaveBeenCalled();
    });

    it('should call onSave when save button is clicked', () => {
      const card = createMockCard({ userNote: 'Note to save' });
      const { container } = render(
        <InsightCardItem card={card} onSave={mockOnSave} />
      );

      // Flip the card
      const frontSide = container.querySelector('.backface-hidden:not(.rotate-y-180)');
      fireEvent.click(frontSide!);

      // Find and click save button (has Save icon)
      const saveButton = screen.getByRole('button', { name: '' });
      fireEvent.click(saveButton);

      expect(mockOnSave).toHaveBeenCalledWith('card-1', 'Note to save');
    });

    it('should sync note with card prop changes', () => {
      const card = createMockCard({ userNote: 'Original note' });
      const { rerender, container } = render(<InsightCardItem card={card} />);

      // Flip to see note
      const frontSide = container.querySelector('.backface-hidden:not(.rotate-y-180)');
      fireEvent.click(frontSide!);

      // Note appears on both sides
      const originalNotes = screen.getAllByText('Original note');
      expect(originalNotes.length).toBeGreaterThanOrEqual(1);

      // Update card prop
      const updatedCard = createMockCard({ userNote: 'Updated note' });
      rerender(<InsightCardItem card={updatedCard} />);

      const updatedNotes = screen.getAllByText('Updated note');
      expect(updatedNotes.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Drag Functionality', () => {
    it('should be draggable by default', () => {
      const card = createMockCard();
      const { container } = render(<InsightCardItem card={card} isDraggable={true} />);

      const draggableElement = container.querySelector('[draggable="true"]');
      expect(draggableElement).toBeInTheDocument();
    });

    it('should not be draggable when isDraggable is false', () => {
      const card = createMockCard();
      const { container } = render(<InsightCardItem card={card} isDraggable={false} />);

      const draggableElement = container.querySelector('[draggable="true"]');
      expect(draggableElement).toBeNull();
    });

    it('should call onDragStart when dragging', () => {
      const card = createMockCard();
      const { container } = render(
        <InsightCardItem
          card={card}
          onDragStart={mockOnDragStart}
          onInternalDragStart={mockOnInternalDragStart}
          isDraggable={true}
        />
      );

      const draggableElement = container.querySelector('[draggable="true"]');

      const dataTransfer = {
        setData: vi.fn(),
        getData: vi.fn(),
        effectAllowed: 'none',
      };

      fireEvent.dragStart(draggableElement!, { dataTransfer });

      expect(mockOnDragStart).toHaveBeenCalledWith(card);
      expect(mockOnInternalDragStart).toHaveBeenCalled();
    });

    it('should set correct data transfer data on drag', () => {
      const card = createMockCard({
        id: 'card-123',
        videoUrl: 'https://youtube.com/watch?v=xyz',
      });
      const { container } = render(<InsightCardItem card={card} isDraggable={true} />);

      const draggableElement = container.querySelector('[draggable="true"]');

      const setDataMock = vi.fn();
      const dataTransfer = {
        setData: setDataMock,
        getData: vi.fn(),
        effectAllowed: 'none',
      };

      fireEvent.dragStart(draggableElement!, { dataTransfer });

      expect(setDataMock).toHaveBeenCalledWith('application/card-id', 'card-123');
      expect(setDataMock).toHaveBeenCalledWith('text/plain', 'https://youtube.com/watch?v=xyz');
    });

    it('should prevent drag when card is flipped', () => {
      const card = createMockCard();
      const { container } = render(
        <InsightCardItem card={card} onDragStart={mockOnDragStart} isDraggable={true} />
      );

      // Initially draggable should be true
      let draggableElement = container.querySelector('[draggable="true"]');
      expect(draggableElement).toBeInTheDocument();

      // Flip the card
      const frontSide = container.querySelector('.backface-hidden:not(.rotate-y-180)');
      fireEvent.click(frontSide!);

      // After flip, draggable should be false (component sets draggable={isDraggable && !isFlipped})
      draggableElement = container.querySelector('[draggable="true"]');
      expect(draggableElement).toBeNull();

      // The element should now have draggable="false"
      const nonDraggableElement = container.querySelector('[draggable="false"]');
      expect(nonDraggableElement).toBeInTheDocument();
    });
  });

  describe('Markdown Link Rendering', () => {
    it('should render markdown links as clickable elements', () => {
      const card = createMockCard({
        userNote: 'Check this [03:31 Important part](https://youtube.com/watch?v=test&t=211s)',
      });
      render(<InsightCardItem card={card} />);

      // Links appear on both front and back sides
      const links = screen.getAllByText('03:31 Important part');
      expect(links.length).toBeGreaterThanOrEqual(1);
      expect(links[0]).toBeInTheDocument();
      expect(links[0].tagName.toLowerCase()).toBe('a');
    });

    it('should render plain text parts alongside links', () => {
      const card = createMockCard({
        userNote: 'Before [link](https://example.com) after',
      });
      render(<InsightCardItem card={card} />);

      // Text appears on both front and back sides
      const beforeTexts = screen.getAllByText('Before');
      const linkTexts = screen.getAllByText('link');
      const afterTexts = screen.getAllByText('after');

      expect(beforeTexts.length).toBeGreaterThanOrEqual(1);
      expect(linkTexts.length).toBeGreaterThanOrEqual(1);
      expect(afterTexts.length).toBeGreaterThanOrEqual(1);
    });

    it('should open video modal when clicking timestamp link in note', () => {
      const card = createMockCard({
        userNote: 'Check this [03:31](https://youtube.com/watch?v=test&t=211s) for details',
      });
      render(<InsightCardItem card={card} />);

      // Find the timestamp link
      const links = screen.getAllByText('03:31');
      expect(links.length).toBeGreaterThanOrEqual(1);

      // Click the link - should prevent default and open modal
      fireEvent.click(links[0]);

      // Video modal should open with the timestamp URL
      expect(screen.getByTestId('video-player-modal')).toBeInTheDocument();
    });
  });

  describe('Video Modal', () => {
    it('should open video modal on Shift+Click on thumbnail', () => {
      const card = createMockCard();
      const { container } = render(<InsightCardItem card={card} />);

      // Find thumbnail area and Shift+Click
      const thumbnailArea = container.querySelector('.aspect-video');
      fireEvent.click(thumbnailArea!, { shiftKey: true });

      expect(screen.getByTestId('video-player-modal')).toBeInTheDocument();
    });

    it('should close video modal when close button is clicked', () => {
      const card = createMockCard();
      const { container } = render(<InsightCardItem card={card} />);

      // Open modal
      const thumbnailArea = container.querySelector('.aspect-video');
      fireEvent.click(thumbnailArea!, { shiftKey: true });

      expect(screen.getByTestId('video-player-modal')).toBeInTheDocument();

      // Close modal
      fireEvent.click(screen.getByTestId('close-modal'));

      expect(screen.queryByTestId('video-player-modal')).not.toBeInTheDocument();
    });

    it('should not open modal on regular click (without Shift)', () => {
      const card = createMockCard();
      const { container } = render(<InsightCardItem card={card} />);

      // Regular click on thumbnail area (not Shift+Click)
      const thumbnailArea = container.querySelector('.aspect-video');
      fireEvent.click(thumbnailArea!);

      // Modal should not open (card flips instead)
      expect(screen.queryByTestId('video-player-modal')).not.toBeInTheDocument();
    });
  });

  describe('Cursor Style', () => {
    it('should have grab cursor when draggable', () => {
      const card = createMockCard();
      const { container } = render(<InsightCardItem card={card} isDraggable={true} />);

      const frontSide = container.querySelector('.backface-hidden:not(.rotate-y-180)');
      expect(frontSide).toHaveClass('cursor-grab');
    });

    it('should have pointer cursor when not draggable', () => {
      const card = createMockCard();
      const { container } = render(<InsightCardItem card={card} isDraggable={false} />);

      const frontSide = container.querySelector('.backface-hidden:not(.rotate-y-180)');
      expect(frontSide).toHaveClass('cursor-pointer');
    });
  });

  describe('Image Error Handling', () => {
    it('should show placeholder on image error', () => {
      const card = createMockCard({ thumbnail: 'https://example.com/broken.jpg' });
      render(<InsightCardItem card={card} />);

      const img = screen.getByRole('img');

      // Simulate image error
      fireEvent.error(img);

      expect(img).toHaveAttribute('src', 'https://via.placeholder.com/320x180?text=Thumbnail');
    });
  });

  describe('X/Twitter Share', () => {
    it('should open X share dialog when share button is clicked', async () => {
      const card = createMockCard({
        title: 'Test Video',
        videoUrl: 'https://youtube.com/watch?v=test123',
        userNote: 'My note',
      });
      const { container } = render(<InsightCardItem card={card} />);

      // Flip the card to see share button
      const frontSide = container.querySelector('.backface-hidden:not(.rotate-y-180)');
      fireEvent.click(frontSide!);

      // Find and click share button (X icon button)
      const shareButton = screen.getByTitle('X에 공유');
      fireEvent.click(shareButton);

      expect(window.open).toHaveBeenCalled();
      const openCall = (window.open as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(openCall[0]).toContain('twitter.com/intent/tweet');
    });

    it('should extract timestamp link from note and use it for share URL', async () => {
      const timestampUrl = 'https://youtube.com/watch?v=abc&t=120';
      const card = createMockCard({
        title: 'Test Video',
        videoUrl: 'https://youtube.com/watch?v=test123',
        userNote: '[2:00](https://youtube.com/watch?v=abc&t=120) This is an interesting point',
      });
      const { container } = render(<InsightCardItem card={card} />);

      // Flip the card to see share button
      const frontSide = container.querySelector('.backface-hidden:not(.rotate-y-180)');
      fireEvent.click(frontSide!);

      // Find and click share button
      const shareButton = screen.getByTitle('X에 공유');
      fireEvent.click(shareButton);

      expect(window.open).toHaveBeenCalled();
      const openCall = (window.open as ReturnType<typeof vi.fn>).mock.calls[0];
      const shareUrlArg = openCall[0] as string;

      // Should use the timestamp URL from the link
      expect(shareUrlArg).toContain(encodeURIComponent(timestampUrl));
      // Should include the link label and remaining text
      expect(shareUrlArg).toContain(encodeURIComponent('2:00'));
      expect(shareUrlArg).toContain(encodeURIComponent('This is an interesting point'));
    });

    it('should use link label only when note contains just a link', async () => {
      const card = createMockCard({
        title: 'Test Video',
        videoUrl: 'https://youtube.com/watch?v=test123',
        userNote: '[3:45](https://youtube.com/watch?v=xyz&t=225)',
      });
      const { container } = render(<InsightCardItem card={card} />);

      // Flip the card
      const frontSide = container.querySelector('.backface-hidden:not(.rotate-y-180)');
      fireEvent.click(frontSide!);

      const shareButton = screen.getByTitle('X에 공유');
      fireEvent.click(shareButton);

      expect(window.open).toHaveBeenCalled();
      const openCall = (window.open as ReturnType<typeof vi.fn>).mock.calls[0];
      const shareUrlArg = openCall[0] as string;

      // Should use the timestamp URL
      expect(shareUrlArg).toContain(encodeURIComponent('https://youtube.com/watch?v=xyz&t=225'));
      // Should use link label as text
      expect(shareUrlArg).toContain(encodeURIComponent('3:45'));
    });
  });
});
