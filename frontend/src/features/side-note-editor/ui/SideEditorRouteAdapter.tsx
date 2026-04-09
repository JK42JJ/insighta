/**
 * URL → store bridge.
 *
 * Watches the current location for `/mandalas/:id/notes/:videoId` and
 * opens/closes the Zustand store accordingly. Renders nothing — pair with
 * <SideEditorHost /> which owns the Sheet itself.
 *
 * Mounted once at the app root (App.tsx) so that it works on every page.
 */
import { useEffect } from 'react';
import { useMatch } from 'react-router-dom';
import { useSideEditorStore } from '../model/useSideEditorStore';

const ROUTE_PATTERN = '/mandalas/:mandalaId/notes/:videoId';

export function SideEditorRouteAdapter() {
  const match = useMatch(ROUTE_PATTERN);
  const open = useSideEditorStore((s) => s.open);
  const close = useSideEditorStore((s) => s.close);

  useEffect(() => {
    if (match?.params.mandalaId && match?.params.videoId) {
      open({
        mandalaId: match.params.mandalaId,
        videoId: match.params.videoId,
        cellIndex: -1,
      });
      return () => {
        close();
      };
    }
    return undefined;
  }, [match?.params.mandalaId, match?.params.videoId, open, close]);

  return null;
}
