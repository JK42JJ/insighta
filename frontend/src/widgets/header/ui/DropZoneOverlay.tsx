import { cn } from '@/shared/lib/utils';

interface DropZoneOverlayProps {
  isVisible: boolean;
  /** Lighter dimming for internal dnd-kit drags (no dashed border) */
  isInternalDrag?: boolean;
}

export function DropZoneOverlay({ isVisible, isInternalDrag = false }: DropZoneOverlayProps) {
  return (
    <div
      className={cn(
        'fixed inset-0 z-30 pointer-events-none transition-all duration-300',
        isVisible ? 'opacity-100' : 'opacity-0'
      )}
    >
      {/* Dimmed background — lighter for internal drags */}
      <div
        className={cn(
          'absolute inset-0',
          isInternalDrag ? 'bg-black/10 dark:bg-black/20' : 'bg-black/20 dark:bg-black/40'
        )}
      />
      {/* Glow border — only for external drags */}
      {!isInternalDrag && (
        <div className="absolute inset-4 border-2 border-dashed border-primary/40 rounded-xl shadow-[inset_0_0_30px_rgba(var(--primary-rgb,110,70,249),0.1)]" />
      )}
    </div>
  );
}
