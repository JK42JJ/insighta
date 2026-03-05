import { useState, useEffect, useRef, useCallback, forwardRef } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import {
  Sparkles,
  Minimize2,
  Maximize2,
  GripHorizontal,
  GripVertical,
  X,
  Move,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTranslation } from 'react-i18next';

export type MandalaDockPosition = 'left' | 'right';

interface FloatingMandalaProps {
  centerGoal: string;
  totalCards: number;
  isMinimized: boolean;
  onToggleMinimized: () => void;
  isFloating: boolean;
  onToggleFloating: () => void;
  dockPosition?: MandalaDockPosition;
  onDockPositionChange?: (position: MandalaDockPosition) => void;
  children: React.ReactNode;
  initialPosition?: { x: number; y: number };
  onPositionChange?: (x: number, y: number) => void;
}

const SIDE_DOCK_THRESHOLD = 100;

export const FloatingMandala = forwardRef<HTMLDivElement, FloatingMandalaProps>(
  function FloatingMandala(
    {
      centerGoal,
      totalCards,
      isMinimized,
      onToggleMinimized,
      isFloating,
      onToggleFloating,
      dockPosition = 'left',
      onDockPositionChange,
      children,
      initialPosition,
      onPositionChange,
    }: FloatingMandalaProps,
    forwardedRef
  ) {
    const { t } = useTranslation();
    const [isSmallScreen, setIsSmallScreen] = useState(false);
    const [position, setPosition] = useState(
      () => initialPosition ?? { x: window.innerWidth - 280, y: 80 }
    );
    // Sync position when initialPosition arrives from async Supabase fetch
    const initX = initialPosition?.x;
    const initY = initialPosition?.y;
    useEffect(() => {
      if (initX != null && initY != null && !isDraggingRef.current) {
        setPosition({ x: initX, y: initY });
      }
    }, [initX, initY]);
    const [isDragging, setIsDragging] = useState(false);
    const [isDockedDragging, setIsDockedDragging] = useState(false);
    const [pendingDock, setPendingDock] = useState<MandalaDockPosition | null>(null);
    const [isAnimating, setIsAnimating] = useState(false);
    const isDraggingRef = useRef(false);
    const dragStartRef = useRef({ x: 0, y: 0 });
    const initialPosRef = useRef({ x: 0, y: 0 });
    const rafRef = useRef<number | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);

    const setContainerRef = useCallback(
      (node: HTMLDivElement | null) => {
        containerRef.current = node;
        if (!forwardedRef) return;
        if (typeof forwardedRef === 'function') forwardedRef(node);
        else forwardedRef.current = node;
      },
      [forwardedRef]
    );

    // Check screen size
    useEffect(() => {
      const checkScreenSize = () => {
        setIsSmallScreen(window.innerHeight < 800 || window.innerWidth < 1024);
      };

      checkScreenSize();
      window.addEventListener('resize', checkScreenSize);
      return () => window.removeEventListener('resize', checkScreenSize);
    }, []);

    // Detect dock position (left or right only for Mandala)
    const detectDockPosition = useCallback((clientX: number): MandalaDockPosition | null => {
      const windowWidth = window.innerWidth;

      if (clientX < SIDE_DOCK_THRESHOLD) {
        return 'left';
      }

      if (clientX > windowWidth - SIDE_DOCK_THRESHOLD) {
        return 'right';
      }

      return null;
    }, []);

    // Handle drag (floating mode)
    const handleDragMouseDown = useCallback(
      (e: React.MouseEvent) => {
        if (isSmallScreen && !isFloating) return;
        e.preventDefault();
        e.stopPropagation();

        dragStartRef.current = { x: e.clientX, y: e.clientY };
        initialPosRef.current = { ...position };
        setIsDragging(true);
        isDraggingRef.current = true;
        setPendingDock(null);
        document.body.style.cursor = 'grabbing';
        document.body.style.userSelect = 'none';
      },
      [isSmallScreen, isFloating, position]
    );

    // Handle drag from docked mode
    const handleDockedDragMouseDown = useCallback(
      (e: React.MouseEvent) => {
        if (isFloating || isSmallScreen) return;
        e.preventDefault();
        e.stopPropagation();

        dragStartRef.current = { x: e.clientX, y: e.clientY };
        setIsDockedDragging(true);
        setPendingDock(null);
      },
      [isFloating, isSmallScreen]
    );

    // Mouse move and up handlers for floating drag
    useEffect(() => {
      if (!isDragging) return;

      const handleMouseMove = (e: MouseEvent) => {
        if (rafRef.current) {
          cancelAnimationFrame(rafRef.current);
        }

        rafRef.current = requestAnimationFrame(() => {
          const dx = e.clientX - dragStartRef.current.x;
          const dy = e.clientY - dragStartRef.current.y;
          const newX = Math.max(0, Math.min(window.innerWidth - 100, initialPosRef.current.x + dx));
          const newY = Math.max(0, Math.min(window.innerHeight - 50, initialPosRef.current.y + dy));
          setPosition({ x: newX, y: newY });

          const dock = detectDockPosition(e.clientX);
          setPendingDock(dock);
        });
      };

      const handleMouseUp = () => {
        if (rafRef.current) {
          cancelAnimationFrame(rafRef.current);
        }
        if (isDragging && pendingDock) {
          setIsAnimating(true);
          onDockPositionChange?.(pendingDock);
          onToggleFloating();
          setTimeout(() => setIsAnimating(false), 300);
        } else if (isDragging) {
          // 플로팅 상태로 드래그 종료 - 위치 저장
          onPositionChange?.(position.x, position.y);
        }
        setIsDragging(false);
        isDraggingRef.current = false;
        setPendingDock(null);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      document.addEventListener('mousemove', handleMouseMove, { passive: true });
      document.addEventListener('mouseup', handleMouseUp);

      return () => {
        if (rafRef.current) {
          cancelAnimationFrame(rafRef.current);
        }
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }, [
      isDragging,
      pendingDock,
      detectDockPosition,
      onDockPositionChange,
      onToggleFloating,
      position.x,
      position.y,
      onPositionChange,
    ]);

    // Handle docked dragging
    useEffect(() => {
      if (!isDockedDragging) return;

      const handleMouseMove = (e: MouseEvent) => {
        if (rafRef.current) {
          cancelAnimationFrame(rafRef.current);
        }

        rafRef.current = requestAnimationFrame(() => {
          const dock = detectDockPosition(e.clientX);
          setPendingDock(dock);
        });
      };

      const handleMouseUp = () => {
        if (rafRef.current) {
          cancelAnimationFrame(rafRef.current);
        }
        if (pendingDock && pendingDock !== dockPosition) {
          setIsAnimating(true);
          onDockPositionChange?.(pendingDock);
          setTimeout(() => setIsAnimating(false), 300);
        }
        setIsDockedDragging(false);
        setPendingDock(null);
      };

      document.addEventListener('mousemove', handleMouseMove, { passive: true });
      document.addEventListener('mouseup', handleMouseUp);

      return () => {
        if (rafRef.current) {
          cancelAnimationFrame(rafRef.current);
        }
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }, [isDockedDragging, pendingDock, dockPosition, detectDockPosition, onDockPositionChange]);

    // 사용자가 지정한 위치를 유지하기 위해 isSmallScreen 변경 시 위치 리셋 제거
    // initialPosition prop이 제공되면 그 위치를 사용, 아니면 기본값 유지

    // Dock zone indicators for visual feedback - subtle line like Ideation
    const DockZoneIndicators = () =>
      createPortal(
        <div
          className="dock-zone-indicators"
          style={{ position: 'fixed', inset: 0, zIndex: 99999, pointerEvents: 'none' }}
        >
          {/* Left dock zone - subtle line indicator */}
          <div
            className={cn(
              'absolute left-0 top-0 bottom-0 transition-all duration-300 ease-out',
              pendingDock === 'left' ? 'opacity-100' : 'opacity-0'
            )}
            style={{ width: '3px' }}
          >
            <div
              className="h-full w-full"
              style={{
                background: 'hsl(var(--primary) / 0.6)',
                boxShadow: '1px 0 8px 0 hsl(var(--primary) / 0.3)',
              }}
            />
          </div>
          {/* Right dock zone - subtle line indicator */}
          <div
            className={cn(
              'absolute right-0 top-0 bottom-0 transition-all duration-300 ease-out',
              pendingDock === 'right' ? 'opacity-100' : 'opacity-0'
            )}
            style={{ width: '3px' }}
          >
            <div
              className="h-full w-full"
              style={{
                background: 'hsl(var(--primary) / 0.6)',
                boxShadow: '-1px 0 8px 0 hsl(var(--primary) / 0.3)',
              }}
            />
          </div>
        </div>,
        document.body
      );

    // Small screen: Floating mini mandala (always floating on small screens)
    if (isSmallScreen) {
      return (
        <div
          ref={setContainerRef}
          className="fixed z-50"
          style={{
            left: position.x,
            top: position.y,
            transition: isDraggingRef.current ? 'none' : 'all 0.15s ease-out',
          }}
        >
          {isMinimized ? (
            // Mini mode: Match FloatingScratchPad floating header style exactly
            <div
              className={cn(
                'flex items-center justify-between px-3 py-2 rounded-xl',
                'bg-surface-mid/98 backdrop-blur-xl border border-border/60',
                'cursor-grab active:cursor-grabbing select-none'
              )}
              style={{
                boxShadow:
                  '0 20px 40px -12px rgba(0, 0, 0, 0.4), 0 8px 16px -8px rgba(0, 0, 0, 0.3)',
                minWidth: '320px',
              }}
              onMouseDown={handleDragMouseDown}
            >
              <div className="flex items-center gap-2">
                <GripHorizontal className="w-4 h-4 text-muted-foreground/40" />
                <div className="p-1 rounded-md bg-primary/10">
                  <Sparkles className="w-3.5 h-3.5 text-primary" />
                </div>
                <span className="text-xs font-semibold text-foreground max-w-[140px] truncate">
                  {centerGoal}
                </span>
                <span className="text-[10px] text-primary font-medium bg-primary/10 px-1.5 py-0.5 rounded">
                  {t('common.items', { count: totalCards })}
                </span>
              </div>
              <div className="flex items-center gap-0.5" onMouseDown={(e) => e.stopPropagation()}>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-foreground"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleMinimized();
                  }}
                >
                  <Maximize2 className="w-3 h-3" />
                </Button>
              </div>
            </div>
          ) : (
            // Expanded mode on small screen
            <div
              className="relative rounded-2xl overflow-hidden backdrop-blur-xl border border-border/60"
              style={{
                boxShadow:
                  '0 20px 40px -12px rgba(0, 0, 0, 0.4), 0 8px 16px -8px rgba(0, 0, 0, 0.3)',
                width: 'min(460px, calc(100vw - 24px))',
                background: 'hsl(var(--surface-mid) / 0.98)',
              }}
            >
              {/* Draggable header bar */}
              <div
                className="flex items-center justify-between px-3 py-2 border-b border-border/30 cursor-grab active:cursor-grabbing select-none"
                onMouseDown={handleDragMouseDown}
              >
                <div className="flex items-center gap-2">
                  <GripHorizontal className="w-4 h-4 text-muted-foreground/40" />
                  <div className="p-1 rounded-md bg-primary/10">
                    <Sparkles className="w-3.5 h-3.5 text-primary" />
                  </div>
                  <span className="text-xs font-semibold text-foreground">{centerGoal}</span>
                  <span className="text-[10px] text-primary font-medium bg-primary/10 px-1.5 py-0.5 rounded">
                    {t('common.items', { count: totalCards })}
                  </span>
                </div>
                <div className="flex items-center gap-0.5" onMouseDown={(e) => e.stopPropagation()}>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-foreground"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleMinimized();
                    }}
                  >
                    <Minimize2 className="w-3 h-3" />
                  </Button>
                </div>
              </div>
              {/* Grid */}
              <div className="p-2">{children}</div>
            </div>
          )}
        </div>
      );
    }

    // Large screen: Floating mode
    if (isFloating) {
      return (
        <>
          {isDragging && <DockZoneIndicators />}

          <div
            ref={setContainerRef}
            className={cn(
              'fixed rounded-xl transition-shadow duration-200 z-50',
              'bg-surface-mid/98 backdrop-blur-xl border border-border/60',
              isDragging && 'cursor-grabbing'
            )}
            style={{
              left: position.x,
              top: position.y,
              width: isMinimized ? 320 : 'min(460px, calc(100vw - 24px))',
              boxShadow: '0 20px 40px -12px rgba(0, 0, 0, 0.4), 0 8px 16px -8px rgba(0, 0, 0, 0.3)',
            }}
          >
            {/* Header Bar */}
            <div
              className={cn(
                'flex items-center justify-between px-3 py-2 border-b border-border/30 cursor-grab select-none',
                isDragging && 'cursor-grabbing'
              )}
              onMouseDown={handleDragMouseDown}
            >
              <div className="flex items-center gap-2">
                <GripHorizontal className="w-4 h-4 text-muted-foreground/40" />
                <div className="p-1 rounded-md bg-primary/10">
                  <Sparkles className="w-3.5 h-3.5 text-primary" />
                </div>
                <span className="text-xs font-semibold text-foreground max-w-[140px] truncate">
                  {centerGoal}
                </span>
                <span className="text-[10px] text-primary font-medium bg-primary/10 px-1.5 py-0.5 rounded">
                  {t('common.items', { count: totalCards })}
                </span>
              </div>

              <div className="flex items-center gap-0.5" onMouseDown={(e) => e.stopPropagation()}>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-foreground"
                  onClick={() => onToggleMinimized()}
                >
                  {isMinimized ? (
                    <Maximize2 className="w-3 h-3" />
                  ) : (
                    <Minimize2 className="w-3 h-3" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-foreground"
                  onClick={onToggleFloating}
                  title={t('mandala.switchToDock')}
                >
                  <X className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>

            {/* Content */}
            {!isMinimized && <div className="p-2">{children}</div>}
          </div>
        </>
      );
    }

    // Large screen: Docked mode (left or right) - Sticky panel like Ideation
    return (
      <>
        {isDockedDragging && <DockZoneIndicators />}

        <div
          ref={setContainerRef}
          className={cn(
            'relative flex flex-col h-full transition-all duration-300',
            'bg-surface-mid/95 backdrop-blur-sm',
            dockPosition === 'left' ? 'border-r border-border/50' : 'border-l border-border/50',
            isDockedDragging && 'opacity-50',
            isAnimating && 'animate-fade-in'
          )}
          style={{
            width: '520px',
            maxWidth: '45vw',
          }}
        >
          {/* Header - Sticky at top */}
          <div
            className="flex items-center justify-between px-3 py-1.5 border-b border-border/30 flex-shrink-0 cursor-grab active:cursor-grabbing select-none"
            onMouseDown={handleDockedDragMouseDown}
          >
            <div className="flex items-center gap-2">
              <GripHorizontal className="w-3 h-3 text-muted-foreground/40" />
              <div className="p-0.5 rounded bg-primary/10">
                <Sparkles className="w-3 h-3 text-primary" />
              </div>
              <span className="text-xs font-semibold text-foreground/90">{t('mandala.title')}</span>
              {totalCards > 0 && (
                <span className="text-[10px] text-primary/70 font-medium bg-primary/10 px-1.5 py-0.5 rounded-full">
                  {t('common.cards', { count: totalCards })}
                </span>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 text-muted-foreground/60 hover:text-foreground hover:bg-muted/50 flex-shrink-0"
              onClick={onToggleFloating}
              title={t('mandala.switchToFloating')}
            >
              <Move className="w-3 h-3" />
            </Button>
          </div>

          {/* Content - No internal scroll, fits content */}
          <div className="flex-1 p-3 flex flex-col justify-start overflow-hidden">{children}</div>
        </div>
      </>
    );
  }
);
