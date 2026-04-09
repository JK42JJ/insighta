/**
 * Global host mounted once in App.tsx.
 *
 * Subscribes to the Zustand store's `isOpen`/`context` and renders a Radix Sheet
 * with the editor panel inside. Closing the Sheet (X / ESC / overlay click) calls
 * `navigate(-1)` so that the URL stays the source of truth — `SideEditorRouteAdapter`
 * will then unmount and clear the store state.
 */
import { useNavigate } from 'react-router-dom';
import { Sheet, SheetContent } from '@/shared/ui/sheet';
import { useSideEditorStore } from '../model/useSideEditorStore';
import { SideEditorPanel } from './SideEditorPanel';
import { SHEET_WIDTH_PX } from '../config';

export function SideEditorHost() {
  const navigate = useNavigate();
  const isOpen = useSideEditorStore((s) => s.isOpen);
  const context = useSideEditorStore((s) => s.context);

  const handleOpenChange = (open: boolean): void => {
    if (!open && isOpen) {
      navigate(-1);
    }
  };

  return (
    <Sheet open={isOpen} onOpenChange={handleOpenChange}>
      <SheetContent
        side="right"
        className="flex flex-col overflow-y-auto sm:max-w-none"
        style={{ width: `${SHEET_WIDTH_PX}px` }}
      >
        {context && <SideEditorPanel videoId={context.videoId} />}
      </SheetContent>
    </Sheet>
  );
}
