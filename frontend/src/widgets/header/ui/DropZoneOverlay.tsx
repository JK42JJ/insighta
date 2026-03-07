import { cn } from '@/shared/lib/utils';

interface DropZoneOverlayProps {
  isVisible: boolean;
}

export function DropZoneOverlay({ isVisible }: DropZoneOverlayProps) {
  // Only show a subtle background indicator, not a blocking overlay
  return (
    <div
      className={cn(
        'fixed inset-0 z-30 pointer-events-none transition-opacity duration-200',
        isVisible ? 'opacity-100' : 'opacity-0'
      )}
    >
      {/* Subtle border glow effect instead of blocking overlay */}
      <div className="absolute inset-4 border-2 border-dashed border-primary/30 rounded-xl" />
    </div>
  );
}
