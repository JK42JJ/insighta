/**
 * @vitest-environment happy-dom
 * Tests for useDragSelect hook
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDragSelect } from '@/hooks/useDragSelect';

describe('useDragSelect', () => {
  let container: HTMLDivElement;
  const mockOnSelectionChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Create container with items
    container = document.createElement('div');
    container.style.position = 'relative';
    container.style.width = '500px';
    container.style.height = '500px';

    // Add mock items
    for (let i = 0; i < 3; i++) {
      const item = document.createElement('div');
      item.className = 'test-item';
      item.setAttribute('data-card-item', 'true');
      item.style.position = 'absolute';
      item.style.left = `${i * 100}px`;
      item.style.top = '100px';
      item.style.width = '80px';
      item.style.height = '80px';
      container.appendChild(item);
    }

    document.body.appendChild(container);

    // Mock getBoundingClientRect for container
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 500,
      bottom: 500,
      width: 500,
      height: 500,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    // Mock getBoundingClientRect for items
    container.querySelectorAll('.test-item').forEach((item, index) => {
      vi.spyOn(item, 'getBoundingClientRect').mockReturnValue({
        left: index * 100,
        top: 100,
        right: index * 100 + 80,
        bottom: 180,
        width: 80,
        height: 80,
        x: index * 100,
        y: 100,
        toJSON: () => ({}),
      });
    });

    // Mock document.elementFromPoint to return null by default
    // This prevents the hook from thinking we clicked on a draggable card
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(null);
  });

  afterEach(() => {
    document.body.removeChild(container);
    vi.useRealTimers();
  });

  it('should initialize with default state', () => {
    const containerRef = { current: container };

    const { result } = renderHook(() =>
      useDragSelect({
        containerRef,
        itemSelector: '.test-item',
        onSelectionChange: mockOnSelectionChange,
      })
    );

    expect(result.current.isDragging).toBe(false);
    expect(result.current.selectionBox).toBeNull();
    expect(result.current.selectionStyle).toBeNull();
    expect(result.current.justFinishedDrag).toBe(false);
  });

  it('should not start drag when disabled', () => {
    const containerRef = { current: container };

    const { result } = renderHook(() =>
      useDragSelect({
        containerRef,
        itemSelector: '.test-item',
        onSelectionChange: mockOnSelectionChange,
        enabled: false,
      })
    );

    // Simulate mousedown
    const mousedownEvent = new MouseEvent('mousedown', {
      clientX: 50,
      clientY: 50,
      button: 0,
      bubbles: true,
    });
    container.dispatchEvent(mousedownEvent);

    // Simulate mousemove past threshold
    const mousemoveEvent = new MouseEvent('mousemove', {
      clientX: 150,
      clientY: 150,
      bubbles: true,
    });
    document.dispatchEvent(mousemoveEvent);

    expect(result.current.isDragging).toBe(false);
  });

  it('should not start drag on right click', () => {
    const containerRef = { current: container };

    const { result } = renderHook(() =>
      useDragSelect({
        containerRef,
        itemSelector: '.test-item',
        onSelectionChange: mockOnSelectionChange,
      })
    );

    // Simulate right click (button: 2)
    const mousedownEvent = new MouseEvent('mousedown', {
      clientX: 50,
      clientY: 50,
      button: 2, // Right click
      bubbles: true,
    });
    container.dispatchEvent(mousedownEvent);

    // Simulate mousemove
    const mousemoveEvent = new MouseEvent('mousemove', {
      clientX: 150,
      clientY: 150,
      bubbles: true,
    });
    document.dispatchEvent(mousemoveEvent);

    expect(result.current.isDragging).toBe(false);
  });

  it('should not start drag when Ctrl key is pressed', () => {
    const containerRef = { current: container };

    const { result } = renderHook(() =>
      useDragSelect({
        containerRef,
        itemSelector: '.test-item',
        onSelectionChange: mockOnSelectionChange,
      })
    );

    // Simulate click with Ctrl key
    const mousedownEvent = new MouseEvent('mousedown', {
      clientX: 50,
      clientY: 50,
      button: 0,
      ctrlKey: true,
      bubbles: true,
    });
    container.dispatchEvent(mousedownEvent);

    // Simulate mousemove
    const mousemoveEvent = new MouseEvent('mousemove', {
      clientX: 150,
      clientY: 150,
      bubbles: true,
    });
    document.dispatchEvent(mousemoveEvent);

    expect(result.current.isDragging).toBe(false);
  });

  it('should not start drag when Meta key is pressed', () => {
    const containerRef = { current: container };

    const { result } = renderHook(() =>
      useDragSelect({
        containerRef,
        itemSelector: '.test-item',
        onSelectionChange: mockOnSelectionChange,
      })
    );

    // Simulate click with Meta key
    const mousedownEvent = new MouseEvent('mousedown', {
      clientX: 50,
      clientY: 50,
      button: 0,
      metaKey: true,
      bubbles: true,
    });
    container.dispatchEvent(mousedownEvent);

    // Simulate mousemove
    const mousemoveEvent = new MouseEvent('mousemove', {
      clientX: 150,
      clientY: 150,
      bubbles: true,
    });
    document.dispatchEvent(mousemoveEvent);

    expect(result.current.isDragging).toBe(false);
  });

  it('should not start drag when clicking on draggable element', () => {
    // Create a draggable element
    const draggableItem = document.createElement('div');
    draggableItem.setAttribute('draggable', 'true');
    draggableItem.style.position = 'absolute';
    draggableItem.style.left = '300px';
    draggableItem.style.top = '100px';
    draggableItem.style.width = '50px';
    draggableItem.style.height = '50px';
    container.appendChild(draggableItem);

    const containerRef = { current: container };

    const { result } = renderHook(() =>
      useDragSelect({
        containerRef,
        itemSelector: '.test-item',
        onSelectionChange: mockOnSelectionChange,
      })
    );

    // Simulate mousedown on draggable element
    const mousedownEvent = new MouseEvent('mousedown', {
      clientX: 310,
      clientY: 110,
      button: 0,
      bubbles: true,
    });
    Object.defineProperty(mousedownEvent, 'target', {
      value: draggableItem,
      writable: false,
    });
    container.dispatchEvent(mousedownEvent);

    // Simulate mousemove past threshold
    const mousemoveEvent = new MouseEvent('mousemove', {
      clientX: 360,
      clientY: 160,
      bubbles: true,
    });
    document.dispatchEvent(mousemoveEvent);

    expect(result.current.isDragging).toBe(false);
  });

  it('should start drag after moving past threshold', () => {
    const containerRef = { current: container };

    const { result } = renderHook(() =>
      useDragSelect({
        containerRef,
        itemSelector: '.test-item',
        onSelectionChange: mockOnSelectionChange,
      })
    );

    // Simulate mousedown and move in same act
    act(() => {
      const mousedownEvent = new MouseEvent('mousedown', {
        clientX: 50,
        clientY: 50,
        button: 0,
        bubbles: true,
      });
      container.dispatchEvent(mousedownEvent);

      // Move past threshold (5px)
      const mousemoveEvent = new MouseEvent('mousemove', {
        clientX: 60, // 10px movement
        clientY: 50,
        bubbles: true,
      });
      document.dispatchEvent(mousemoveEvent);
    });

    expect(result.current.isDragging).toBe(true);
  });

  it('should not start drag if movement is below threshold', () => {
    const containerRef = { current: container };

    const { result } = renderHook(() =>
      useDragSelect({
        containerRef,
        itemSelector: '.test-item',
        onSelectionChange: mockOnSelectionChange,
      })
    );

    // Simulate mousedown
    act(() => {
      const mousedownEvent = new MouseEvent('mousedown', {
        clientX: 50,
        clientY: 50,
        button: 0,
        bubbles: true,
      });
      container.dispatchEvent(mousedownEvent);
    });

    // Move below threshold (5px)
    act(() => {
      const mousemoveEvent = new MouseEvent('mousemove', {
        clientX: 53, // Only 3px movement
        clientY: 52,
        bubbles: true,
      });
      document.dispatchEvent(mousemoveEvent);
    });

    expect(result.current.isDragging).toBe(false);
  });

  it('should update selection box during drag', () => {
    const containerRef = { current: container };

    const { result } = renderHook(() =>
      useDragSelect({
        containerRef,
        itemSelector: '.test-item',
        onSelectionChange: mockOnSelectionChange,
      })
    );

    // Start drag
    act(() => {
      const mousedownEvent = new MouseEvent('mousedown', {
        clientX: 50,
        clientY: 50,
        button: 0,
        bubbles: true,
      });
      container.dispatchEvent(mousedownEvent);

      const mousemoveEvent = new MouseEvent('mousemove', {
        clientX: 100,
        clientY: 100,
        bubbles: true,
      });
      document.dispatchEvent(mousemoveEvent);
    });

    expect(result.current.isDragging).toBe(true);
    expect(result.current.selectionBox).not.toBeNull();

    // Continue dragging
    act(() => {
      const mousemoveEvent = new MouseEvent('mousemove', {
        clientX: 200,
        clientY: 200,
        bubbles: true,
      });
      document.dispatchEvent(mousemoveEvent);
    });

    expect(result.current.selectionBox?.endX).toBe(200);
    expect(result.current.selectionBox?.endY).toBe(200);
  });

  it('should call onSelectionChange on mouseup with selected indices', () => {
    const containerRef = { current: container };

    renderHook(() =>
      useDragSelect({
        containerRef,
        itemSelector: '.test-item',
        onSelectionChange: mockOnSelectionChange,
      })
    );

    // Start drag and trigger threshold
    act(() => {
      const mousedownEvent = new MouseEvent('mousedown', {
        clientX: 10,
        clientY: 10,
        button: 0,
        bubbles: true,
      });
      container.dispatchEvent(mousedownEvent);

      // First mousemove triggers drag start
      const mousemoveEvent = new MouseEvent('mousemove', {
        clientX: 90,
        clientY: 190,
        bubbles: true,
      });
      document.dispatchEvent(mousemoveEvent);
    });

    // Second mousemove updates the selection box coordinates
    act(() => {
      const mousemoveEvent = new MouseEvent('mousemove', {
        clientX: 90,
        clientY: 190,
        bubbles: true,
      });
      document.dispatchEvent(mousemoveEvent);
    });

    // Release mouse
    act(() => {
      const mouseupEvent = new MouseEvent('mouseup', {
        bubbles: true,
      });
      document.dispatchEvent(mouseupEvent);
    });

    expect(mockOnSelectionChange).toHaveBeenCalled();
  });

  it('should clear selection box on mouseup', () => {
    const containerRef = { current: container };

    const { result } = renderHook(() =>
      useDragSelect({
        containerRef,
        itemSelector: '.test-item',
        onSelectionChange: mockOnSelectionChange,
      })
    );

    // Start drag
    act(() => {
      const mousedownEvent = new MouseEvent('mousedown', {
        clientX: 50,
        clientY: 50,
        button: 0,
        bubbles: true,
      });
      container.dispatchEvent(mousedownEvent);

      const mousemoveEvent = new MouseEvent('mousemove', {
        clientX: 100,
        clientY: 100,
        bubbles: true,
      });
      document.dispatchEvent(mousemoveEvent);
    });

    expect(result.current.isDragging).toBe(true);

    // Release mouse
    act(() => {
      const mouseupEvent = new MouseEvent('mouseup', {
        bubbles: true,
      });
      document.dispatchEvent(mouseupEvent);
    });

    expect(result.current.isDragging).toBe(false);
    expect(result.current.selectionBox).toBeNull();
  });

  it('should set justFinishedDrag flag temporarily after drag ends', async () => {
    vi.useFakeTimers();
    const containerRef = { current: container };

    const { result } = renderHook(() =>
      useDragSelect({
        containerRef,
        itemSelector: '.test-item',
        onSelectionChange: mockOnSelectionChange,
      })
    );

    // Start drag and trigger threshold
    act(() => {
      const mousedownEvent = new MouseEvent('mousedown', {
        clientX: 50,
        clientY: 50,
        button: 0,
        bubbles: true,
      });
      container.dispatchEvent(mousedownEvent);

      const mousemoveEvent = new MouseEvent('mousemove', {
        clientX: 100,
        clientY: 100,
        bubbles: true,
      });
      document.dispatchEvent(mousemoveEvent);
    });

    // Second mousemove to update selection box
    act(() => {
      const mousemoveEvent = new MouseEvent('mousemove', {
        clientX: 100,
        clientY: 100,
        bubbles: true,
      });
      document.dispatchEvent(mousemoveEvent);
    });

    // Release mouse
    act(() => {
      const mouseupEvent = new MouseEvent('mouseup', {
        bubbles: true,
      });
      document.dispatchEvent(mouseupEvent);
    });

    expect(result.current.justFinishedDrag).toBe(true);

    // After 100ms, justFinishedDrag should be false
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });

    expect(result.current.justFinishedDrag).toBe(false);
    vi.useRealTimers();
  });

  it('should return correct selectionStyle during drag', () => {
    const containerRef = { current: container };

    const { result } = renderHook(() =>
      useDragSelect({
        containerRef,
        itemSelector: '.test-item',
        onSelectionChange: mockOnSelectionChange,
      })
    );

    // Start drag - combine mousedown and mousemove in single act
    act(() => {
      const mousedownEvent = new MouseEvent('mousedown', {
        clientX: 50,
        clientY: 50,
        button: 0,
        bubbles: true,
      });
      container.dispatchEvent(mousedownEvent);

      const mousemoveEvent = new MouseEvent('mousemove', {
        clientX: 150,
        clientY: 150,
        bubbles: true,
      });
      document.dispatchEvent(mousemoveEvent);
    });

    expect(result.current.isDragging).toBe(true);
    expect(result.current.selectionStyle).not.toBeNull();

    // Check style properties
    expect(result.current.selectionStyle).toMatchObject({
      position: 'absolute',
      backgroundColor: 'rgba(255, 107, 61, 0.15)',
      border: '1px solid rgba(255, 107, 61, 0.5)',
      borderRadius: '4px',
      pointerEvents: 'none',
      zIndex: 50,
    });
  });

  it('should set body userSelect to none during drag', () => {
    const containerRef = { current: container };

    renderHook(() =>
      useDragSelect({
        containerRef,
        itemSelector: '.test-item',
        onSelectionChange: mockOnSelectionChange,
      })
    );

    // Start drag - combine mousedown and mousemove in single act
    act(() => {
      const mousedownEvent = new MouseEvent('mousedown', {
        clientX: 50,
        clientY: 50,
        button: 0,
        bubbles: true,
      });
      container.dispatchEvent(mousedownEvent);

      const mousemoveEvent = new MouseEvent('mousemove', {
        clientX: 100,
        clientY: 100,
        bubbles: true,
      });
      document.dispatchEvent(mousemoveEvent);
    });

    expect(document.body.style.userSelect).toBe('none');
  });

  it('should reset body userSelect when drag ends', () => {
    const containerRef = { current: container };

    renderHook(() =>
      useDragSelect({
        containerRef,
        itemSelector: '.test-item',
        onSelectionChange: mockOnSelectionChange,
      })
    );

    // Start drag - combine mousedown and mousemove in single act
    act(() => {
      const mousedownEvent = new MouseEvent('mousedown', {
        clientX: 50,
        clientY: 50,
        button: 0,
        bubbles: true,
      });
      container.dispatchEvent(mousedownEvent);

      const mousemoveEvent = new MouseEvent('mousemove', {
        clientX: 100,
        clientY: 100,
        bubbles: true,
      });
      document.dispatchEvent(mousemoveEvent);
    });

    expect(document.body.style.userSelect).toBe('none');

    // End drag
    act(() => {
      const mouseupEvent = new MouseEvent('mouseup', {
        bubbles: true,
      });
      document.dispatchEvent(mouseupEvent);
    });

    expect(document.body.style.userSelect).toBe('');
  });

  it('should handle containerRef being null', () => {
    const containerRef = { current: null };

    const { result } = renderHook(() =>
      useDragSelect({
        containerRef,
        itemSelector: '.test-item',
        onSelectionChange: mockOnSelectionChange,
      })
    );

    expect(result.current.isDragging).toBe(false);
    expect(result.current.selectionBox).toBeNull();
  });

  it('should clean up event listeners on unmount', () => {
    const containerRef = { current: container };

    const removeEventListenerSpy = vi.spyOn(container, 'removeEventListener');
    const documentRemoveEventListenerSpy = vi.spyOn(
      document,
      'removeEventListener'
    );

    const { unmount } = renderHook(() =>
      useDragSelect({
        containerRef,
        itemSelector: '.test-item',
        onSelectionChange: mockOnSelectionChange,
      })
    );

    unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      'mousedown',
      expect.any(Function)
    );
    expect(documentRemoveEventListenerSpy).toHaveBeenCalledWith(
      'mousemove',
      expect.any(Function)
    );
    expect(documentRemoveEventListenerSpy).toHaveBeenCalledWith(
      'mouseup',
      expect.any(Function)
    );
  });

  it('should prevent default on mousedown to avoid text selection', () => {
    const containerRef = { current: container };

    renderHook(() =>
      useDragSelect({
        containerRef,
        itemSelector: '.test-item',
        onSelectionChange: mockOnSelectionChange,
      })
    );

    const mousedownEvent = new MouseEvent('mousedown', {
      clientX: 50,
      clientY: 50,
      button: 0,
      bubbles: true,
      cancelable: true,
    });
    const preventDefaultSpy = vi.spyOn(mousedownEvent, 'preventDefault');

    container.dispatchEvent(mousedownEvent);

    expect(preventDefaultSpy).toHaveBeenCalled();
  });

  it('should not start drag when clicking on a card item that is also draggable (selected card)', () => {
    // Create a card item that is also draggable (simulating a selected card)
    const draggableCardItem = document.createElement('div');
    draggableCardItem.className = 'test-item';
    draggableCardItem.setAttribute('data-card-item', 'true');
    draggableCardItem.setAttribute('draggable', 'true');
    draggableCardItem.style.position = 'absolute';
    draggableCardItem.style.left = '350px';
    draggableCardItem.style.top = '100px';
    draggableCardItem.style.width = '80px';
    draggableCardItem.style.height = '80px';
    container.appendChild(draggableCardItem);

    // Mock elementFromPoint to return this draggable card item
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(draggableCardItem);

    const containerRef = { current: container };

    const { result } = renderHook(() =>
      useDragSelect({
        containerRef,
        itemSelector: '.test-item',
        onSelectionChange: mockOnSelectionChange,
      })
    );

    // Simulate mousedown (starts pending state)
    act(() => {
      const mousedownEvent = new MouseEvent('mousedown', {
        clientX: 360,
        clientY: 110,
        button: 0,
        bubbles: true,
      });
      container.dispatchEvent(mousedownEvent);
    });

    // Move past threshold - but since we clicked on a draggable card item, drag should not start
    act(() => {
      const mousemoveEvent = new MouseEvent('mousemove', {
        clientX: 380, // 20px movement, past threshold
        clientY: 120,
        bubbles: true,
      });
      document.dispatchEvent(mousemoveEvent);
    });

    // Drag selection should NOT start because we clicked on a draggable card
    expect(result.current.isDragging).toBe(false);
    expect(result.current.selectionBox).toBeNull();
  });
});
