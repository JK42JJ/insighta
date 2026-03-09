import { cn } from '@/shared/lib/utils';

interface DropZoneOverlayProps {
  isVisible: boolean;
}

export function DropZoneOverlay({ isVisible }: DropZoneOverlayProps) {
  return (
    <div
      className={cn(
        'fixed inset-0 z-30 pointer-events-none transition-all duration-300',
        isVisible ? 'opacity-100' : 'opacity-0',
      )}
    >
      {/* Dimmed background */}
      <div className="absolute inset-0 bg-black/20 dark:bg-black/40" />
      {/* Glow border */}
      <div className="absolute inset-4 border-2 border-dashed border-primary/40 rounded-xl shadow-[inset_0_0_30px_rgba(var(--primary-rgb,110,70,249),0.1)]" />
    </div>
  );
}
