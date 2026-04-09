/**
 * Global host mounted once in App.tsx.
 *
 * Subscribes to the Zustand store's `isOpen`/`context` and renders a Radix Sheet
 * with the editor panel inside. Closing the Sheet (X / ESC / overlay click) calls
 * `navigate(-1)` so that the URL stays the source of truth — `SideEditorRouteAdapter`
 * will then unmount and clear the store state.
 */
import { Sheet, SheetContent } from '@/shared/ui/sheet';
import { useSideEditorStore } from '../model/useSideEditorStore';
import { SideEditorPanel } from './SideEditorPanel';
import { SHEET_WIDTH_PX } from '../config';

export function SideEditorHost() {
  const isOpen = useSideEditorStore((s) => s.isOpen);
  const context = useSideEditorStore((s) => s.context);
  const close = useSideEditorStore((s) => s.close);

  const handleOpenChange = (open: boolean): void => {
    if (!open) close();
  };

  return (
    <Sheet open={isOpen} onOpenChange={handleOpenChange} modal={false}>
      <SheetContent
        side="right"
        className="z-[60] flex flex-col overflow-y-auto border-l border-border shadow-2xl sm:max-w-none"
        style={{ width: `${SHEET_WIDTH_PX}px` }}
        onInteractOutside={(e) => e.preventDefault()}
      >
        {context && <SideEditorPanel cardId={context.cardId} />}
      </SheetContent>
    </Sheet>
  );
}
