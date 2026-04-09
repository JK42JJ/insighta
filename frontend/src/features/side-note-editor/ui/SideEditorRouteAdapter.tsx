/**
 * URL → store bridge.
 *
 * Watches the current location for `/notes/:videoId` and opens/closes the
 * Zustand store accordingly. Reads optional `?mandala=<id>` from the query
 * string so scratchpad cards (no mandala) are fully supported.
 *
 * Mounted once at the app root (App.tsx) so that it works on every page.
 */
import { useEffect } from 'react';
import { useMatch, useSearchParams } from 'react-router-dom';
import { useSideEditorStore } from '../model/useSideEditorStore';

const ROUTE_PATTERN = '/notes/:videoId';

export function SideEditorRouteAdapter() {
  const match = useMatch(ROUTE_PATTERN);
  const [searchParams] = useSearchParams();
  const open = useSideEditorStore((s) => s.open);
  const close = useSideEditorStore((s) => s.close);

  useEffect(() => {
    if (match?.params.videoId) {
      open({
        videoId: match.params.videoId,
        mandalaId: searchParams.get('mandala'),
      });
      return () => {
        close();
      };
    }
    return undefined;
  }, [match?.params.videoId, searchParams, open, close]);

  return null;
}
