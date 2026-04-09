/**
 * Global host mounted once in App.tsx.
 *
 * Uses a plain CSS-animated div instead of Radix Sheet to avoid
 * Dialog-Dialog conflicts (Radix closes one when another opens).
 * The VideoPlayerModal stays open while this panel slides in.
 */
import { useEffect, useCallback } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { useSideEditorStore, sideEditorSaveRef } from '../model/useSideEditorStore';
import { SideEditorPanel } from './SideEditorPanel';
import { SHEET_WIDTH_PX } from '../config';

export function SideEditorHost() {
  const isOpen = useSideEditorStore((s) => s.isOpen);
  const context = useSideEditorStore((s) => s.context);
  const close = useSideEditorStore((s) => s.close);

  const handleClose = useCallback(() => {
    close();
    sideEditorSaveRef.current = null;
  }, [close]);

  // ESC to close (only the side editor, not the modal behind it)
  useEffect(() => {
    if (!isOpen) return undefined;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        handleClose();
      }
    };
    window.addEventListener('keydown', handler, true); // capture phase
    return () => window.removeEventListener('keydown', handler, true);
  }, [isOpen, handleClose]);

  return (
    <div
      className={cn(
        'fixed inset-y-0 right-0 z-[60] flex flex-col',
        'border-l border-border/20 bg-background shadow-2xl',
        'transition-transform duration-300 ease-out',
        isOpen ? 'translate-x-0' : 'translate-x-full'
      )}
      style={{ width: `${SHEET_WIDTH_PX}px` }}
    >
      {/* Close button */}
      <button
        type="button"
        onClick={handleClose}
        className="absolute right-4 top-4 z-10 rounded-sm p-1 text-muted-foreground/60 transition-colors hover:text-foreground"
        aria-label="Close"
      >
        <X className="h-4 w-4" />
      </button>

      {context && (
        <SideEditorPanel
          cardId={context.cardId}
          initialNote={context.initialNote}
          videoTitle={context.videoTitle}
          onSaveNote={(cardId, note) => sideEditorSaveRef.current?.(cardId, note)}
        />
      )}
    </div>
  );
}
